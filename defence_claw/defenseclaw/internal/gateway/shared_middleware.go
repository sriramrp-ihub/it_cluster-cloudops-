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
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"strings"
)

// ExtractTokenFromRequest extracts an API token from Authorization Bearer header,
// X-DefenseClaw-Token, or X-DC-Auth headers.
func ExtractTokenFromRequest(r *http.Request) string {
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	if token := r.Header.Get("X-DefenseClaw-Token"); token != "" {
		return token
	}
	if dcAuth := r.Header.Get("X-DC-Auth"); strings.HasPrefix(dcAuth, "Bearer ") {
		return strings.TrimPrefix(dcAuth, "Bearer ")
	}
	return ""
}

// ConstantTimeStringMatch compares two strings in constant time using SHA-256 digests
// to prevent timing leaks of length or mismatch offset.
func ConstantTimeStringMatch(a, b string) bool {
	ha := sha256.Sum256([]byte(a))
	hb := sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(ha[:], hb[:]) == 1
}

// NewTokenAuthMiddleware creates a reusable authentication middleware requiring expectedToken.
// GET /health is explicitly exempted to allow unauthenticated container liveness checks.
func NewTokenAuthMiddleware(expectedToken string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/health" && r.Method == http.MethodGet {
				next.ServeHTTP(w, r)
				return
			}
			if expectedToken == "" {
				w.Header().Set("Content-Type", "application/json")
				http.Error(w, `{"error":"sidecar misconfigured: no gateway token"}`, http.StatusServiceUnavailable)
				return
			}
			token := ExtractTokenFromRequest(r)
			if token == "" {
				w.Header().Set("Content-Type", "application/json")
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			if !ConstantTimeStringMatch(token, expectedToken) {
				w.Header().Set("Content-Type", "application/json")
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// APIBodyLimitMiddleware caps the request body on mutating HTTP methods.
// maxBytes applies to ordinary API requests (default: 1 MiB).
func APIBodyLimitMiddleware(next http.Handler, maxBytes, otlpMaxBytes int64) http.Handler {
	return apiBodyLimitMiddleware(next, maxBytes, otlpMaxBytes)
}

// PerIPRateLimiter returns an http.Handler middleware that throttles each remote IP.
func PerIPRateLimiter(rps, burst int) func(http.Handler) http.Handler {
	return perIPRateLimiter(rps, burst)
}

// APICSRFProtectMiddleware wraps handlers with CSRF protections:
// requires X-DefenseClaw-Client header on POST/PUT/PATCH/DELETE, checks Sec-Fetch-Site,
// and enforces application/json Content-Type. GET/HEAD/OPTIONS are exempt.
func APICSRFProtectMiddleware(next http.Handler) http.Handler {
	return csrfProtect(next)
}
