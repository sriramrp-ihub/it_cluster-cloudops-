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

package opa

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/open-policy-agent/opa/rego"
)

// Client evaluates OPA / Rego authorization policies in-process or via HTTP.
type Client struct {
	mu            sync.RWMutex
	endpoint      string
	bundlePath    string
	preparedQuery *rego.PreparedEvalQuery
	httpClient    *http.Client
}

// NewClient creates an OPA evaluation client.
func NewClient(endpoint string) (*Client, error) {
	return &Client{
		endpoint: strings.TrimRight(endpoint, "/"),
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},
	}, nil
}

// LoadBundle loads Rego files from the specified bundle directory for in-process evaluation.
func (c *Client) LoadBundle(bundlePath string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.bundlePath = bundlePath
	if bundlePath == "" {
		return nil
	}

	info, err := os.Stat(bundlePath)
	if err != nil {
		// If bundle path is missing on filesystem, still allow remote HTTP query fallback
		if c.endpoint != "" {
			return nil
		}
		return fmt.Errorf("stat bundle path %s: %w", bundlePath, err)
	}

	var regoPaths []string
	if info.IsDir() {
		err := filepath.Walk(bundlePath, func(path string, f os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if !f.IsDir() && strings.HasSuffix(f.Name(), ".rego") {
				regoPaths = append(regoPaths, path)
			}
			return nil
		})
		if err != nil {
			return fmt.Errorf("walk bundle dir %s: %w", bundlePath, err)
		}
	} else {
		regoPaths = []string{bundlePath}
	}

	if len(regoPaths) == 0 {
		return nil
	}

	r := rego.New(
		rego.Query("data.cloudops.authz"),
		rego.Load(regoPaths, nil),
	)

	ctx := context.Background()
	pq, err := r.PrepareForEval(ctx)
	if err != nil {
		return fmt.Errorf("prepare rego query: %w", err)
	}

	c.preparedQuery = &pq
	return nil
}

// Query evaluates a query with input.
func (c *Client) Query(ctx context.Context, query string, input interface{}) (interface{}, error) {
	c.mu.RLock()
	pq := c.preparedQuery
	endpoint := c.endpoint
	c.mu.RUnlock()

	// 1. In-process Rego evaluation if prepared
	if pq != nil {
		rs, err := pq.Eval(ctx, rego.EvalInput(input))
		if err != nil {
			return nil, fmt.Errorf("eval rego: %w", err)
		}
		if len(rs) == 0 || len(rs[0].Expressions) == 0 {
			return nil, nil
		}

		res := rs[0].Expressions[0].Value
		if query == "data.cloudops.authz.allow" {
			// Return the full map so caller can inspect allow, verdict, reason, and rule_id
			if m, ok := res.(map[string]interface{}); ok {
				return m, nil
			}
		}
		return res, nil
	}

	// 2. HTTP query fallback if endpoint is configured
	if endpoint != "" {
		relPath := strings.TrimPrefix(query, "data.")
		url := fmt.Sprintf("%s/v1/data/%s", endpoint, strings.ReplaceAll(relPath, ".", "/"))
		bodyData, err := json.Marshal(map[string]interface{}{"input": input})
		if err != nil {
			return nil, fmt.Errorf("marshal input: %w", err)
		}

		req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyData))
		if err != nil {
			return nil, fmt.Errorf("new http request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("http post %s: %w", url, err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("opa returned HTTP %d", resp.StatusCode)
		}

		var payload struct {
			Result interface{} `json:"result"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			return nil, fmt.Errorf("decode opa response: %w", err)
		}
		return payload.Result, nil
	}

	return nil, fmt.Errorf("no prepared rego bundle or opa endpoint available")
}

// Close closes the OPA client.
func (c *Client) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.preparedQuery = nil
	return nil
}
