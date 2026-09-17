"use client";

import React from "react";
import { SkillMultiSelect } from "../../../components/agents/SkillMultiSelect";
import { SkillItem } from "../../../lib/api";

interface StepSkillsProps {
  skills: SkillItem[];
  selectedSkills: string[];
  onChange: (skills: string[]) => void;
  loading?: boolean;
}

export const StepSkills: React.FC<StepSkillsProps> = ({
  skills,
  selectedSkills,
  onChange,
  loading = false
}) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div>
        <h4 style={{ fontSize: "16px", fontWeight: 600, color: "var(--near-black-ink)", marginBottom: "4px" }}>
          Operational Skills Library
        </h4>
        <p style={{ fontSize: "13px", color: "var(--mid-warm-gray)" }}>
          Equip the agent with structured workflows for incident diagnosis, ECS task troubleshooting, and automated remediation.
        </p>
      </div>

      <SkillMultiSelect
        skills={skills}
        selectedSkills={selectedSkills}
        onChange={onChange}
        loading={loading}
      />
    </div>
  );
};
