// Copyright 2026 Cisco Systems, Inc. and its affiliates
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

package cli

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/defenseclaw/defenseclaw/internal/gateway"
	"github.com/defenseclaw/defenseclaw/internal/gateway/connector/cloudops"
	"github.com/defenseclaw/defenseclaw/internal/schemas"
)

func setupTestServeHandler(t *testing.T, expectedToken string) http.Handler {
	t.Helper()
	mux := http.NewServeMux()

	policyDir := filepath.Join("..", "..", "policies", "rego", "cloudops")
	conn, err := cloudops.New(cloudops.CloudOpsConfig{
		PolicyBundlePath: policyDir,
		TenantID:         "ten_default_tenant",
	})
	if err != nil {
		t.Fatalf("failed to init cloudops connector: %v", err)
	}

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	var auditEventsMu sync.RWMutex
	var auditEvents []schemas.GatewayEventEnvelope

	mux.HandleFunc("/v1/evaluate", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var req cloudops.CapabilityRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			var maxBytesError *http.MaxBytesError
			if errors.As(err, &maxBytesError) {
				http.Error(w, "request entity too large", http.StatusRequestEntityTooLarge)
				return
			}
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		traceparent := r.Header.Get("traceparent")
		if traceparent != "" && req.Traceparent == "" {
			req.Traceparent = traceparent
		}
		resp, err := conn.EvaluateCapability(r.Context(), req)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		auditEventsMu.Lock()
		auditEvents = append(auditEvents, resp.AuditEvent)
		auditEventsMu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	})

	mux.HandleFunc("/v1/audit/events", func(w http.ResponseWriter, r *http.Request) {
		traceID := r.URL.Query().Get("trace_id")
		traceparent := r.URL.Query().Get("traceparent")
		if traceID == "" && traceparent != "" {
			parts := strings.Split(traceparent, "-")
			if len(parts) >= 2 {
				traceID = parts[1]
			}
		}
		auditEventsMu.RLock()
		defer auditEventsMu.RUnlock()
		var matched []schemas.GatewayEventEnvelope
		for _, ev := range auditEvents {
			if traceID == "" || ev.TraceID == traceID {
				matched = append(matched, ev)
			}
		}
		if matched == nil {
			matched = []schemas.GatewayEventEnvelope{}
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(matched)
	})

	var handler http.Handler = mux
	handler = gateway.APIBodyLimitMiddleware(handler, 1<<20, 1<<20)
	handler = gateway.APICSRFProtectMiddleware(handler)
	handler = gateway.PerIPRateLimiter(20, 40)(handler)
	handler = gateway.NewTokenAuthMiddleware(expectedToken)(handler)
	return handler
}

func TestServeCmdHardening(t *testing.T) {
	token := "secure-test-token-xyz"
	handler := setupTestServeHandler(t, token)

	t.Run("GET /health is unauthenticated", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
	})

	t.Run("POST /v1/evaluate rejects missing token with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader(`{"capability":"test"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DefenseClaw-Client", "cloudops")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 for missing token, got %d", rec.Code)
		}
	})

	t.Run("POST /v1/evaluate rejects invalid token with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader(`{"capability":"test"}`))
		req.Header.Set("Authorization", "Bearer invalid-token")
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-DefenseClaw-Client", "cloudops")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 for invalid token, got %d", rec.Code)
		}
	})

	t.Run("POST /v1/evaluate rejects missing CSRF header with 403", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader(`{"capability":"test"}`))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		// Missing X-DefenseClaw-Client
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 for missing CSRF client header, got %d", rec.Code)
		}
	})

	t.Run("POST /v1/evaluate rejects invalid content type with 415", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader(`{"capability":"test"}`))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-DefenseClaw-Client", "cloudops")
		req.Header.Set("Content-Type", "text/plain")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnsupportedMediaType {
			t.Fatalf("expected 415 for invalid content type, got %d", rec.Code)
		}
	})

	t.Run("POST /v1/evaluate succeeds with valid token, CSRF, and json", func(t *testing.T) {
		payload := `{"agent_id":"ag_test","tenant_id":"ten_default_tenant","capability":"aws.ecs.describe_clusters","arguments":{}}`
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader(payload))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-DefenseClaw-Client", "cloudops")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("POST /v1/evaluate rejects body exceeding 1 MiB limit", func(t *testing.T) {
		oversized := bytes.Repeat([]byte(" "), (1<<20)+100)
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", bytes.NewReader(oversized))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-DefenseClaw-Client", "cloudops")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("expected 413 for oversized body, got %d", rec.Code)
		}
	})

	t.Run("GET /v1/audit/events rejects unauthenticated request with 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/audit/events", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", rec.Code)
		}
	})

	t.Run("GET /v1/audit/events returns empty array without mock synthesis on unmatched trace_id", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/audit/events?trace_id=nonexistent-trace-id-12345", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}

		var events []schemas.GatewayEventEnvelope
		if err := json.NewDecoder(rec.Body).Decode(&events); err != nil {
			t.Fatalf("failed to decode response: %v", err)
		}
		if len(events) != 0 {
			t.Fatalf("expected 0 events for unmatched trace_id (no synthetic mock event!), got %d: %+v", len(events), events)
		}
	})

	t.Run("POST /v1/evaluate rate limiter enforces burst limit (40) on remote client IP", func(t *testing.T) {
		clientIP := "172.18.0.2:54321" // Simulated Docker bridge network IP (non-loopback)
		payload := `{"agent_id":"ag_test","tenant_id":"ten_default_tenant","capability":"aws.ecs.describe_clusters","arguments":{}}`

		// Send 40 requests rapidly — all within burst capacity should succeed with 200
		for i := 0; i < 40; i++ {
			req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader(payload))
			req.RemoteAddr = clientIP
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("X-DefenseClaw-Client", "cloudops")
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("request %d within burst capacity failed: code=%d body=%s", i+1, rec.Code, rec.Body.String())
			}
		}

		// The 41st request exceeding burst capacity must be rejected with 429 Too Many Requests
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader(payload))
		req.RemoteAddr = clientIP
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-DefenseClaw-Client", "cloudops")
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusTooManyRequests {
			t.Fatalf("expected 429 Too Many Requests for request exceeding burst limit, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("POST /v1/evaluate loopback requests (127.0.0.1) bypass rate limiter", func(t *testing.T) {
		loopbackAddr := "127.0.0.1:54321"
		payload := `{"agent_id":"ag_test","tenant_id":"ten_default_tenant","capability":"aws.ecs.describe_clusters","arguments":{}}`

		// Send 50 requests rapidly from loopback — all should succeed even past 40
		for i := 0; i < 50; i++ {
			req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader(payload))
			req.RemoteAddr = loopbackAddr
			req.Header.Set("Authorization", "Bearer "+token)
			req.Header.Set("X-DefenseClaw-Client", "cloudops")
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("loopback request %d failed: code=%d body=%s", i+1, rec.Code, rec.Body.String())
			}
		}
	})

	t.Run("POST /v1/evaluate with unconfigured empty token fails closed with 503 for any request", func(t *testing.T) {
		unconfiguredHandler := setupTestServeHandler(t, "")

		// Request with no auth header
		reqNoAuth := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader("{}"))
		reqNoAuth.Header.Set("X-DefenseClaw-Client", "cloudops")
		reqNoAuth.Header.Set("Content-Type", "application/json")
		recNoAuth := httptest.NewRecorder()
		unconfiguredHandler.ServeHTTP(recNoAuth, reqNoAuth)
		if recNoAuth.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503 for unconfigured token with no auth header, got %d", recNoAuth.Code)
		}

		// Request with empty auth header
		reqEmptyAuth := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader("{}"))
		reqEmptyAuth.Header.Set("Authorization", "")
		reqEmptyAuth.Header.Set("X-DefenseClaw-Client", "cloudops")
		reqEmptyAuth.Header.Set("Content-Type", "application/json")
		recEmptyAuth := httptest.NewRecorder()
		unconfiguredHandler.ServeHTTP(recEmptyAuth, reqEmptyAuth)
		if recEmptyAuth.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503 for unconfigured token with empty auth header, got %d", recEmptyAuth.Code)
		}

		// Request with a token
		reqWithToken := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader("{}"))
		reqWithToken.Header.Set("Authorization", "Bearer some-token")
		reqWithToken.Header.Set("X-DefenseClaw-Client", "cloudops")
		reqWithToken.Header.Set("Content-Type", "application/json")
		recWithToken := httptest.NewRecorder()
		unconfiguredHandler.ServeHTTP(recWithToken, reqWithToken)
		if recWithToken.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503 for unconfigured token with non-empty auth header, got %d", recWithToken.Code)
		}
	})
}
