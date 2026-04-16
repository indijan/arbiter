import "server-only";

type ExecutionSettings = {
  dry_run?: boolean;
  risk_profile?: "conservative" | "aggressive";
  capital_allocation_pct?: number;
};

type ExecutionStubResult = {
  accepted: false;
  reason: "execution_layer_not_enabled";
  opportunity_id: string | number;
  settings: ExecutionSettings;
};

export async function executeOpportunity(
  opportunity: { opportunity_id: string | number },
  settings: ExecutionSettings = {}
): Promise<ExecutionStubResult> {
  return {
    accepted: false,
    reason: "execution_layer_not_enabled",
    opportunity_id: opportunity.opportunity_id,
    settings
  };
}
