"use client";

import React, { useState } from "react";
import { SkillItem } from "../../../../lib/api";

interface SkillsTabProps {
  skills: SkillItem[];
}

export const SkillsTab: React.FC<SkillsTabProps> = ({ skills }) => {
  const [enabledSkills, setEnabledSkills] = useState<string[]>(
    skills.map((s) => s.id)
  );

  const toggleSkill = (id: string, builtIn: boolean) => {
    if (builtIn) return; // builtIns cannot be disabled
    if (enabledSkills.includes(id)) {
      setEnabledSkills(enabledSkills.filter((s) => s !== id));
    } else {
      setEnabledSkills([...enabledSkills, id]);
    }
  };

  return (
    <div
      style={{
        padding: "1.5rem",
        backgroundColor: "var(--pure-white)",
        borderRadius: "8px",
        border: "1px solid var(--border-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: "1rem"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h4 style={{ fontSize: "15px", fontWeight: 600, color: "var(--near-black-ink)" }}>
          Configured Operational Skills ({enabledSkills.length} Active)
        </h4>
        <span style={{ fontSize: "12px", color: "var(--muted-gray)" }}>
          Toggle specialized diagnostic workflows
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
        {skills.map((skill) => {
          const isEnabled = enabledSkills.includes(skill.id);
          return (
            <div
              key={skill.id}
              style={{
                padding: "1rem",
                borderRadius: "6px",
                border: "1px solid var(--border-subtle)",
                backgroundColor: isEnabled ? "#ffffff" : "#fbfaf8",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                gap: "8px",
                opacity: isEnabled ? 1 : 0.6
              }}
            >
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--near-black-ink)" }}>
                    {skill.name}
                  </span>
                  {skill.builtIn ? (
                    <span style={{ fontSize: "10px", fontWeight: 600, backgroundColor: "#dcfce7", color: "#166534", padding: "2px 6px", borderRadius: "3px" }}>
                      BUILT-IN
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleSkill(skill.id, skill.builtIn)}
                      style={{
                        padding: "3px 10px",
                        fontSize: "11px",
                        fontWeight: 600,
                        borderRadius: "12px",
                        border: "1px solid var(--warm-gray-border)",
                        backgroundColor: isEnabled ? "var(--near-black-ink)" : "#ffffff",
                        color: isEnabled ? "#ffffff" : "var(--mid-warm-gray)",
                        cursor: "pointer"
                      }}
                    >
                      {isEnabled ? "Enabled" : "Disabled"}
                    </button>
                  )}
                </div>
                <p style={{ fontSize: "12px", color: "var(--mid-warm-gray)", lineHeight: "1.4" }}>
                  {skill.description}
                </p>
              </div>

              <span style={{ fontSize: "11px", fontFamily: "var(--font-mono)", color: "var(--muted-gray)" }}>
                category: {skill.category}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
