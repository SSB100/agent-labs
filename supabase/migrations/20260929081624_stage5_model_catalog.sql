insert into public.model_definitions (
  id, model_key, display_name, provider, provider_family, provider_model_id,
  tier, status, context_window_tokens, max_output_tokens, capabilities,
  input_price_per_million_usd, output_price_per_million_usd,
  cache_read_price_per_million_usd, metadata
)
values
  ('00000000-0000-4000-8000-000000000511','luna.standard','GPT-6 Luna','openrouter','openai','openai/gpt-6-luna','standard','qualified',1050000,128000,'["structured_output","tool_use","large_context","reasoning","vision","files"]',0.10,0.50,0.01,'{"catalogSource":"openrouter","catalogCheckedAt":"2026-09-29T00:00:00.000Z"}'),
  ('00000000-0000-4000-8000-000000000512','gemini.flash.large','Gemini 3.8 Flash','openrouter','google','google/gemini-3.8-flash','large_context','qualified',1048576,65536,'["structured_output","tool_use","large_context","reasoning","vision","files"]',0.75,3.75,0.075,'{"catalogSource":"openrouter","catalogCheckedAt":"2026-09-29T00:00:00.000Z"}'),
  ('00000000-0000-4000-8000-000000000513','claude.haiku.review','Claude Haiku 4.5','openrouter','anthropic','anthropic/claude-haiku-4.5','review','qualified',200000,64000,'["structured_output","tool_use","reasoning","vision","files"]',1.00,5.00,0.10,'{"catalogSource":"openrouter","catalogCheckedAt":"2026-09-29T00:00:00.000Z"}'),
  ('00000000-0000-4000-8000-000000000514','sol.high-power','GPT-6 Sol','openrouter','openai','openai/gpt-6-sol','high_power','qualified',1050000,128000,'["structured_output","tool_use","large_context","reasoning","vision","files"]',2.00,10.00,0.20,'{"catalogSource":"openrouter","catalogCheckedAt":"2026-09-29T00:00:00.000Z"}'),
  ('00000000-0000-4000-8000-000000000515','claude.sonnet.high-power','Claude Sonnet 4.6','openrouter','anthropic','anthropic/claude-sonnet-4.6','high_power','qualified',1000000,128000,'["structured_output","tool_use","large_context","reasoning","vision","files"]',3.00,15.00,0.30,'{"catalogSource":"openrouter","catalogCheckedAt":"2026-09-29T00:00:00.000Z"}')
on conflict (model_key) do update set
  display_name=excluded.display_name,
  provider=excluded.provider,
  provider_family=excluded.provider_family,
  provider_model_id=excluded.provider_model_id,
  tier=excluded.tier,
  status=excluded.status,
  context_window_tokens=excluded.context_window_tokens,
  max_output_tokens=excluded.max_output_tokens,
  capabilities=excluded.capabilities,
  input_price_per_million_usd=excluded.input_price_per_million_usd,
  output_price_per_million_usd=excluded.output_price_per_million_usd,
  cache_read_price_per_million_usd=excluded.cache_read_price_per_million_usd,
  metadata=excluded.metadata,
  updated_at=now();

insert into public.model_qualifications (
  id, model_definition_id, qualification_type, status, evidence, checked_at, qualified_at
)
values
  ('00000000-0000-4000-8000-000000000531','00000000-0000-4000-8000-000000000511','structured_output','qualified','{"source":"openrouter_catalog","liveValidated":false}','2026-09-29T00:00:00Z','2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000532','00000000-0000-4000-8000-000000000511','tool_use','qualified','{"source":"openrouter_catalog","liveValidated":false}','2026-09-29T00:00:00Z','2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000533','00000000-0000-4000-8000-000000000512','structured_output','qualified','{"source":"openrouter_catalog","liveValidated":false}','2026-09-29T00:00:00Z','2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000534','00000000-0000-4000-8000-000000000512','tool_use','qualified','{"source":"openrouter_catalog","liveValidated":false}','2026-09-29T00:00:00Z','2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000535','00000000-0000-4000-8000-000000000513','structured_output','qualified','{"source":"openrouter_catalog","liveValidated":false}','2026-09-29T00:00:00Z','2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000536','00000000-0000-4000-8000-000000000513','tool_use','qualified','{"source":"openrouter_catalog","liveValidated":false}','2026-09-29T00:00:00Z','2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000537','00000000-0000-4000-8000-000000000514','structured_output','qualified','{"source":"openrouter_catalog","liveValidated":false}','2026-09-29T00:00:00Z','2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000538','00000000-0000-4000-8000-000000000514','tool_use','qualified','{"source":"openrouter_catalog","liveValidated":false}','2026-09-29T00:00:00Z','2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000539','00000000-0000-4000-8000-000000000515','structured_output','qualified','{"source":"openrouter_catalog","liveValidated":false}','2026-09-29T00:00:00Z','2026-09-29T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000540','00000000-0000-4000-8000-000000000515','tool_use','qualified','{"source":"openrouter_catalog","liveValidated":false}','2026-09-29T00:00:00Z','2026-09-29T00:00:00Z')
on conflict (model_definition_id, qualification_type) do update set
  status=excluded.status,
  evidence=excluded.evidence,
  checked_at=excluded.checked_at,
  qualified_at=excluded.qualified_at,
  updated_at=now();

insert into public.model_routes (
  id, route_key, name, description, status, requirements,
  primary_model_definition_id, fallback_model_definition_id,
  maximum_attempts, metadata
)
values
  ('00000000-0000-4000-8000-000000000521','standard.default','Standard workhorse','Economical default for routine structured work, with a different provider family as fallback.','qualified','{"structuredOutput":true,"toolUse":false,"minimumContextTokens":200000,"preferredProviderFamily":"openai","independentFallback":true}','00000000-0000-4000-8000-000000000511','00000000-0000-4000-8000-000000000512',2,'{"policyVersion":"1.0.0"}'),
  ('00000000-0000-4000-8000-000000000522','reviewer.independent','Independent reviewer','Anthropic-family review route with an OpenAI-family fallback.','qualified','{"structuredOutput":true,"toolUse":false,"minimumContextTokens":200000,"preferredProviderFamily":"anthropic","independentFallback":true}','00000000-0000-4000-8000-000000000513','00000000-0000-4000-8000-000000000511',2,'{"policyVersion":"1.0.0"}'),
  ('00000000-0000-4000-8000-000000000523','escalation.high-power','High-power escalation','Bounded high-power route with an independent Claude-family fallback.','qualified','{"structuredOutput":true,"toolUse":true,"minimumContextTokens":1000000,"preferredProviderFamily":"openai","independentFallback":true}','00000000-0000-4000-8000-000000000514','00000000-0000-4000-8000-000000000515',2,'{"policyVersion":"1.0.0"}'),
  ('00000000-0000-4000-8000-000000000524','large-context','Large-context specialist','Gemini-class route for tasks that materially require a very large context window.','qualified','{"structuredOutput":true,"toolUse":true,"minimumContextTokens":1000000,"preferredProviderFamily":"google","independentFallback":true}','00000000-0000-4000-8000-000000000512','00000000-0000-4000-8000-000000000511',2,'{"policyVersion":"1.0.0"}')
on conflict (route_key) do update set
  name=excluded.name,
  description=excluded.description,
  status=excluded.status,
  requirements=excluded.requirements,
  primary_model_definition_id=excluded.primary_model_definition_id,
  fallback_model_definition_id=excluded.fallback_model_definition_id,
  maximum_attempts=excluded.maximum_attempts,
  metadata=excluded.metadata,
  updated_at=now();