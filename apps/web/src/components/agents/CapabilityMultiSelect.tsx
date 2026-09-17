"use client";

import React, { useState } from "react";
import { CapabilityItem } from "../../lib/api";

interface CapabilityMultiSelectProps {
  capabilities: CapabilityItem[];
  selectedCapabilities: string[];
  onChange: (selected: string[]) => void;
  loading?: boolean;
}

export const CapabilityMultiSelect: React.FC<CapabilityMultiSelectProps> = ({
  capabilities,
  selectedCapabilities,
  onChange,
  loading = false
}) => {
  const [search, setSearch] = useState("");
  const [activeTierFilter, setActiveTierFilter] = useState<"all" | "read" | "mutate" | "deploy">("all");

  const filtered = capabilities.filter((c) => {
    const matchesSearch =
      c.id.toLowerCase().includes(search.toLowerCase()) ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.description.toLowerCase().includes(search.toLowerCase());
    const matchesTier = activeTierFilter === "all" || c.tier === activeTierFilter;
    return matchesSearch && matchesTier;
  });

  const toggleCap = (id: string) => {
    if (selectedCapabilities.includes(id)) {
      onChange(selectedCapabilities.filter((c) => c !== id));
    } else {
      onChange([...selectedCapabilities, id]);
    }
  };

  const selectAllFiltered = () => {
    const idsToAdd = filtered.map((f) => f.id);
    const combined = Array.from(new Set([...selectedCapabilities, ...idsToAdd]));
    onChange(combined);
  };

  const deselectAllFiltered = () => {
    const idsToRemove = new Set(filtered.map((f) => f.id));
    onChange(selectedCapabilities.filter((id) => !idsToRemove.has(id)));
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case "read":
        return { bg: "#ecfdf5", text: "#065f46" };
      case "mutate":
        return { bg: "#fef3c7", text: "#92400e" };
      case "deploy":
        return { bg: "#fee2e2", text: "#991b1b" };
      default:
        return { bg: "#f2f1ef", text: "#33312c" };
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
        <input
          type="text"
          placeholder="Filter capabilities (e.g. ecs, cloudwatch, deploy)..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "8px 12px",
            borderRadius: "4px",
            border: "1px solid var(--warm-gray-border)",
            fontSize: "13px",
            fontFamily: "var(--font-sans)",
            flex: "1 1 240px",
            maxWidth: "360px",
            backgroundColor: "var(--pure-white)"
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {(["all", "read", "mutate", "deploy"] as const).map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => setActiveTierFilter(tier)}
              style={{
                padding: "4px 10px",
                fontSize: "12px",
                borderRadius: "4px",
                border: activeTierFilter === tier ? "1px solid var(--near-black-ink)" : "1px solid var(--border-subtle)",
                backgroundColor: activeTierFilter === tier ? "var(--near-black-ink)" : "transparent",
                color: activeTierFilter === tier ? "#ffffff" : "var(--mid-warm-gray)",
                cursor: "pointer",
                textTransform: "capitalize",
                fontWeight: activeTierFilter === tier ? 600 : 400
              }}
            >
              {tier}
            </button>
          ))}
          <span style={{ margin: "0 4px", color: "var(--border-subtle)" }}>|</span>
          <button
            type="button"
            onClick={selectAllFiltered}
            style={{
              padding: "4px 8px",
              fontSize: "12px",
              background: "none",
              border: "none",
              color: "var(--near-black-ink)",
              cursor: "pointer",
              textDecoration: "underline"
            }}
          >
            Select All
          </button>
          <button
            type="button"
            onClick={deselectAllFiltered}
            style={{
              padding: "4px 8px",
              fontSize: "12px",
              background: "none",
              border: "none",
              color: "var(--muted-gray)",
              cursor: "pointer"
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Capabilities List */}
      <div
        style={{
          border: "1px solid var(--border-subtle)",
          borderRadius: "6px",
          backgroundColor: "var(--pure-white)",
          maxHeight: "340px",
          overflowY: "auto"
        }}
      >
        {loading ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--mid-warm-gray)", fontSize: "14px" }}>
            Loading capability registry...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--mid-warm-gray)", fontSize: "14px" }}>
            No capabilities matching criteria.
          </div>
        ) : (
          filtered.map((cap) => {
            const isSelected = selectedCapabilities.includes(cap.id);
            const tierStyle = getTierColor(cap.tier);

            return (
              <div
                key={cap.id}
                onClick={() => toggleCap(cap.id)}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "12px",
                  padding: "10px 14px",
                  borderBottom: "1px solid #f2f1ef",
                  cursor: "pointer",
                  backgroundColor: isSelected ? "rgba(15, 14, 13, 0.02)" : "transparent",
                  transition: "background-color 0.1s ease"
                }}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => {}} // handled by parent div
                  style={{ marginTop: "3px", cursor: "pointer" }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "2px" }}>
                    <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)" }}>
                      {cap.name}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "11px",
                        color: "var(--muted-gray)"
                      }}
                    >
                      ({cap.id})
                    </span>
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        padding: "1px 6px",
                        borderRadius: "3px",
                        backgroundColor: tierStyle.bg,
                        color: tierStyle.text
                      }}
                    >
                      {cap.tier}
                    </span>
                    <span
                      style={{
                        fontSize: "10px",
                        fontFamily: "var(--font-mono)",
                        textTransform: "uppercase",
                        padding: "1px 5px",
                        borderRadius: "3px",
                        backgroundColor: "#f2f1ef",
                        color: "#706d66"
                      }}
                    >
                      {cap.provider}
                    </span>
                  </div>
                  <p style={{ fontSize: "12px", color: "var(--mid-warm-gray)", lineHeight: "1.4" }}>
                    {cap.description}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div style={{ fontSize: "12px", color: "var(--muted-gray)", display: "flex", justifyContent: "space-between" }}>
        <span>Selected: {selectedCapabilities.length} / {capabilities.length} capabilities</span>
        <span>Governance: Mutating & deploy capabilities require Ed25519 authorization</span>
      </div>
    </div>
  );
};
