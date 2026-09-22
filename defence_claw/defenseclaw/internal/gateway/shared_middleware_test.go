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

package gateway

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSharedTokenAuthMiddleware(t *testing.T) {
	expectedToken := "correct-secret-token"
	authMw := NewTokenAuthMiddleware(expectedToken)

	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	handler := authMw(dummyHandler)

	t.Run("health check bypasses auth", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 for /health, got %d", rec.Code)
		}
	})

	t.Run("missing token returns 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader("{}"))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 for missing token, got %d", rec.Code)
		}
	})

	t.Run("invalid token returns 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader("{}"))
		req.Header.Set("Authorization", "Bearer wrong-token")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 for wrong token, got %d", rec.Code)
		}
	})

	t.Run("valid bearer token succeeds", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader("{}"))
		req.Header.Set("Authorization", "Bearer "+expectedToken)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 for valid token, got %d", rec.Code)
		}
	})

	t.Run("valid X-DefenseClaw-Token header succeeds", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader("{}"))
		req.Header.Set("X-DefenseClaw-Token", expectedToken)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 for valid X-DefenseClaw-Token, got %d", rec.Code)
		}
	})

	t.Run("valid X-DC-Auth header succeeds", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader("{}"))
		req.Header.Set("X-DC-Auth", "Bearer "+expectedToken)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 for valid X-DC-Auth, got %d", rec.Code)
		}
	})

	t.Run("empty expected token returns 503 fail-closed", func(t *testing.T) {
		misconfiguredMw := NewTokenAuthMiddleware("")(dummyHandler)

		// With a non-empty bearer token -> 503
		reqWithToken := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader("{}"))
		reqWithToken.Header.Set("Authorization", "Bearer some-token")
		recWithToken := httptest.NewRecorder()
		misconfiguredMw.ServeHTTP(recWithToken, reqWithToken)
		if recWithToken.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503 for unconfigured token with non-empty header, got %d", recWithToken.Code)
		}

		// With NO token header -> 503 (must NOT treat "" == "" as authenticated!)
		reqNoToken := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader("{}"))
		recNoToken := httptest.NewRecorder()
		misconfiguredMw.ServeHTTP(recNoToken, reqNoToken)
		if recNoToken.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503 for unconfigured token with absent header, got %d", recNoToken.Code)
		}

		// With EMPTY token header -> 503 (must NOT treat "" == "" as authenticated!)
		reqEmptyToken := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader("{}"))
		reqEmptyToken.Header.Set("Authorization", "")
		recEmptyToken := httptest.NewRecorder()
		misconfiguredMw.ServeHTTP(recEmptyToken, reqEmptyToken)
		if recEmptyToken.Code != http.StatusServiceUnavailable {
			t.Fatalf("expected 503 for unconfigured token with empty header, got %d", recEmptyToken.Code)
		}
	})
}

func TestSharedBodyLimitMiddleware(t *testing.T) {
	const maxBytes int64 = 64
	readHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusRequestEntityTooLarge)
			return
		}
		w.WriteHeader(http.StatusOK)
	})

	handler := APIBodyLimitMiddleware(readHandler, maxBytes, maxBytes)

	t.Run("body under limit succeeds", func(t *testing.T) {
		body := bytes.Repeat([]byte("a"), 32)
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", bytes.NewReader(body))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
	})

	t.Run("body over limit rejected", func(t *testing.T) {
		body := bytes.Repeat([]byte("a"), 128)
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", bytes.NewReader(body))
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("expected 413, got %d", rec.Code)
		}
	})
}

func TestSharedCSRFProtectMiddleware(t *testing.T) {
	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	handler := APICSRFProtectMiddleware(dummyHandler)

	t.Run("GET is exempt", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/health", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 for GET, got %d", rec.Code)
		}
	})

	t.Run("POST missing X-DefenseClaw-Client header returns 403", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403, got %d", rec.Code)
		}
	})

	t.Run("POST with invalid Content-Type returns 415", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader("text"))
		req.Header.Set("X-DefenseClaw-Client", "test-client")
		req.Header.Set("Content-Type", "text/plain")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnsupportedMediaType {
			t.Fatalf("expected 415, got %d", rec.Code)
		}
	})

	t.Run("POST with Sec-Fetch-Site=cross-site returns 403", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader("{}"))
		req.Header.Set("X-DefenseClaw-Client", "test-client")
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Sec-Fetch-Site", "cross-site")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403, got %d", rec.Code)
		}
	})

	t.Run("valid POST succeeds", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/evaluate", strings.NewReader("{}"))
		req.Header.Set("X-DefenseClaw-Client", "test-client")
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
	})
}
