"use client";

import React from "react";

export interface WizardStepMeta {
  number: number;
  title: string;
  description: string;
}

interface AgentWizardProps {
  currentStep: number;
  steps: WizardStepMeta[];
  children: React.ReactNode;
  onNext?: () => void;
  onBack?: () => void;
  canGoNext?: boolean;
  nextLabel?: string;
  isSubmitting?: boolean;
  hideFooter?: boolean;
}

export const AgentWizard: React.FC<AgentWizardProps> = ({
  currentStep,
  steps,
  children,
  onNext,
  onBack,
  canGoNext = true,
  nextLabel = "Continue",
  isSubmitting = false,
  hideFooter = false
}) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* 1. Wizard Stepper Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "1rem 1.5rem",
          backgroundColor: "var(--pure-white)",
          borderRadius: "8px",
          border: "1px solid var(--border-subtle)",
          overflowX: "auto"
        }}
      >
        {steps.map((step, idx) => {
          const isCurrent = step.number === currentStep;
          const isPassed = step.number < currentStep;

          return (
            <React.Fragment key={step.number}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  opacity: isCurrent || isPassed ? 1 : 0.5,
                  minWidth: "fit-content"
                }}
              >
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    fontWeight: 600,
                    backgroundColor: isPassed ? "#16a34a" : isCurrent ? "var(--near-black-ink)" : "#f2f1ef",
                    color: isPassed || isCurrent ? "#ffffff" : "var(--mid-warm-gray)",
                    transition: "all 0.15s ease"
                  }}
                >
                  {isPassed ? "✓" : step.number}
                </div>

                <div>
                  <span
                    style={{
                      display: "block",
                      fontSize: "13px",
                      fontWeight: isCurrent ? 600 : 500,
                      color: isCurrent ? "var(--near-black-ink)" : "var(--dark-warm-gray)"
                    }}
                  >
                    {step.title}
                  </span>
                  <span style={{ display: "block", fontSize: "11px", color: "var(--muted-gray)" }}>
                    {step.description}
                  </span>
                </div>
              </div>

              {idx < steps.length - 1 && (
                <div
                  style={{
                    flex: "1 1 20px",
                    height: "1px",
                    backgroundColor: isPassed ? "#16a34a" : "var(--border-subtle)",
                    margin: "0 12px",
                    minWidth: "16px"
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* 2. Step Content Body */}
      <div
        style={{
          padding: "2rem",
          backgroundColor: "var(--pure-white)",
          borderRadius: "8px",
          border: "1px solid var(--border-subtle)",
          boxShadow: "0 1px 3px rgba(15, 14, 13, 0.04)"
        }}
      >
        {children}

        {/* 3. Wizard Footer Navigation */}
        {!hideFooter && currentStep < 5 && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "2.5rem",
              paddingTop: "1.5rem",
              borderTop: "1px solid var(--border-subtle)"
            }}
          >
            {currentStep > 1 ? (
              <button
                type="button"
                onClick={onBack}
                style={{
                  padding: "8px 18px",
                  fontSize: "13px",
                  fontWeight: 500,
                  borderRadius: "4px",
                  border: "1px solid var(--warm-gray-border)",
                  backgroundColor: "#ffffff",
                  color: "var(--dark-warm-gray)",
                  cursor: "pointer"
                }}
              >
                &larr; Back
              </button>
            ) : (
              <div />
            )}

            <button
              type="button"
              onClick={onNext}
              disabled={!canGoNext || isSubmitting}
              style={{
                padding: "8px 24px",
                fontSize: "13px",
                fontWeight: 600,
                borderRadius: "4px",
                border: "none",
                backgroundColor: "var(--near-black-ink)",
                color: "#ffffff",
                cursor: !canGoNext || isSubmitting ? "not-allowed" : "pointer",
                opacity: !canGoNext ? 0.6 : 1
              }}
            >
              {nextLabel} &rarr;
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
