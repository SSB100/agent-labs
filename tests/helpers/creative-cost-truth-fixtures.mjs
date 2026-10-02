// Synthetic analogue of a three-call creative history. These IDs and rows are inert.
export function creativeCostTruthFixture({ creativeRunId = 'fixture-run', businessId = 'fixture-business', workflowRunId = 'fixture-workflow' } = {}) {
  const created_at = '2026-10-01T10:00:00.000Z', settled_at = '2026-10-01T10:01:00.000Z';
  const calls = [
    { call_key: 'brief:1', reserved_microusd: 30051, reported_microusd: 1979, provider_request_id: 'fixture-brief' },
    { call_key: 'screen:1', reserved_microusd: 99501, reported_microusd: 8301, provider_request_id: 'fixture-screen' },
    { call_key: 'generate:1', reserved_microusd: 210000, reported_microusd: 210000, provider_request_id: null },
  ];
  const reservations = calls.map(({ call_key, reserved_microusd }) => ({ creative_run_id: creativeRunId, business_id: businessId, call_key, reserved_microusd, created_at }));
  const settlements = calls.map(({ call_key, reported_microusd, provider_request_id }) => ({ creative_run_id: creativeRunId, business_id: businessId, call_key, reported_microusd, provider_request_id, created_at: settled_at,
    ...(call_key === 'generate:1' ? { receipt: { reportedCostUsd: .21, estimatedMicrousd: 210000, outputValidated: false } } : {}),
  }));
  return { reservations, settlements, costs: calls.map(call => ({ ...call, creative_run_id: creativeRunId, created_at, settled_at })),
    workflowRun: { id: workflowRunId, business_id: businessId }, creativeRun: { id: creativeRunId, business_id: businessId, workflow_run_id: workflowRunId, approval_id: 'fixture-approval' } };
}
