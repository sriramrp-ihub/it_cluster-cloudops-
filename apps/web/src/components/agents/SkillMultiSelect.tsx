"use client";

import React from "react";
import { SkillItem } from "../../lib/api";

interface SkillMultiSelectProps {
  skills: SkillItem[];
  selectedSkills: string[];
  onChange: (selected: string[]) => void;
  loading?: boolean;
}

export const SkillMultiSelect: React.FC<SkillMultiSelectProps> = ({
  skills,
  selectedSkills,
  onChange,
  loading = false
}) => {
  const builtIns = skills.filter((s) => s.builtIn);
  const company = skills.filter((s) => !s.builtIn);

  const toggleSkill = (id: string) => {
    if (selectedSkills.includes(id)) {
      onChange(selectedSkills.filter((s) => s !== id));
    } else {
      onChange([...selectedSkills, id]);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* 1. Built-in Runtime Skills (Locked/Always Included) */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.5rem" }}>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--near-black-ink)" }}>
            Built-in Runtime Skills
          </span>
          <span
            style={{
              fontSize: "11px",
              backgroundColor: "#f2f1ef",
              color: "var(--mid-warm-gray)",
              padding: "2px 8px",
              borderRadius: "4px"
            }}
          >
            Always Active
          </span>
        </div>
        <p style={{ fontSize: "13px", color: "var(--muted-gray)", marginBottom: "0.75rem" }}>
          These core diagnostic and policy capabilities are embedded directly in the CloudOps runtime daemon.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.75rem" }}>
          {builtIns.map((skill) => (
            <div
              key={skill.id}
              style={{
                padding: "1rem",
                borderRadius: "6px",
                border: "1px solid var(--border-subtle)",
                backgroundColor: "#fcfbf9",
                display: "flex",
                flexDirection: "column",
                gap: "4px"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--dark-warm-gray)" }}>
                  {skill.name}
                </span>
                <span style={{ fontSize: "10px", color: "#166534", backgroundColor: "#dcfce7", padding: "1px 6px", borderRadius: "3px", fontWeight: 600 }}>
                  BUILT-IN
                </span>
              </div>
              <p style={{ fontSize: "12px", color: "var(--mid-warm-gray)", lineHeight: "1.4" }}>
                {skill.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 2. Company Skills Library (Selectable) */}
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.5rem" }}>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--near-black-ink)" }}>
            Company Skills Library
          </span>
          <span style={{ fontSize: "12px", color: "var(--muted-gray)" }}>
            (Optional specialized workflows)
          </span>
        </div>

        {loading ? (
          <div style={{ padding: "1rem", textAlign: "center", color: "var(--muted-gray)", fontSize: "13px" }}>
            Loading skills library...
          </div>
        ) : company.length === 0 ? (
          <div style={{ padding: "1rem", textAlign: "center", color: "var(--muted-gray)", fontSize: "13px" }}>
            No additional company skills registered.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "0.75rem" }}>
            {company.map((skill) => {
              const isSelected = selectedSkills.includes(skill.id);
              return (
                <div
                  key={skill.id}
                  onClick={() => toggleSkill(skill.id)}
                  style={{
                    padding: "1rem",
                    borderRadius: "6px",
                    border: isSelected ? "2px solid var(--near-black-ink)" : "1px solid var(--warm-gray-border)",
                    backgroundColor: isSelected ? "var(--pure-white)" : "#fafaf9",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "10px",
                    transition: "all 0.15s ease",
                    boxShadow: isSelected ? "0 2px 8px rgba(15, 14, 13, 0.06)" : "none"
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => {}}
                    style={{ marginTop: "3px", cursor: "pointer" }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2px" }}>
                      <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--near-black-ink)" }}>
                        {skill.name}
                      </span>
                      <span style={{ fontSize: "10px", color: "var(--muted-gray)", textTransform: "uppercase" }}>
                        {skill.category}
                      </span>
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--mid-warm-gray)", lineHeight: "1.4" }}>
                      {skill.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
