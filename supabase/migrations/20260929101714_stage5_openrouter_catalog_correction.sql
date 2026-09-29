update public.model_definitions
set
  display_name = 'GPT-5.6 Luna',
  provider_model_id = 'openai/gpt-5.6-luna',
  input_price_per_million_usd = 0.10,
  output_price_per_million_usd = 0.60,
  cache_read_price_per_million_usd = 0.01,
  metadata = metadata || jsonb_build_object(
    'catalogSource', 'openrouter',
    'catalogCheckedAt', '2026-09-29T10:20:00.000Z',
    'liveValidated', false
  ),
  updated_at = now()
where model_key = 'luna.standard';

update public.model_definitions
set
  display_name = 'Gemini 3.6 Flash',
  provider_model_id = 'google/gemini-3.6-flash',
  input_price_per_million_usd = 1.50,
  output_price_per_million_usd = 7.50,
  cache_read_price_per_million_usd = 0.15,
  metadata = metadata || jsonb_build_object(
    'catalogSource', 'openrouter',
    'catalogCheckedAt', '2026-09-29T10:20:00.000Z',
    'liveValidated', false
  ),
  updated_at = now()
where model_key = 'gemini.flash.large';

update public.model_definitions
set
  provider_model_id = 'anthropic/claude-haiku-4.5',
  input_price_per_million_usd = 1.00,
  output_price_per_million_usd = 5.00,
  cache_read_price_per_million_usd = 0.10,
  metadata = metadata || jsonb_build_object(
    'catalogSource', 'openrouter',
    'catalogCheckedAt', '2026-09-29T10:20:00.000Z',
    'liveValidated', false
  ),
  updated_at = now()
where model_key = 'claude.haiku.review';

update public.model_definitions
set
  display_name = 'GPT-5.6 Sol',
  provider_model_id = 'openai/gpt-5.6-sol',
  input_price_per_million_usd = 2.50,
  output_price_per_million_usd = 15.00,
  cache_read_price_per_million_usd = 0.25,
  metadata = metadata || jsonb_build_object(
    'catalogSource', 'openrouter',
    'catalogCheckedAt', '2026-09-29T10:20:00.000Z',
    'liveValidated', false
  ),
  updated_at = now()
where model_key = 'sol.high-power';

update public.model_definitions
set
  provider_model_id = 'anthropic/claude-sonnet-4.6',
  input_price_per_million_usd = 3.00,
  output_price_per_million_usd = 15.00,
  cache_read_price_per_million_usd = 0.30,
  metadata = metadata || jsonb_build_object(
    'catalogSource', 'openrouter',
    'catalogCheckedAt', '2026-09-29T10:20:00.000Z',
    'liveValidated', false
  ),
  updated_at = now()
where model_key = 'claude.sonnet.high-power';

update public.model_qualifications qualification
set
  evidence = qualification.evidence || jsonb_build_object(
    'source', 'openrouter_catalog_2026-09-29',
    'liveValidated', false
  ),
  checked_at = '2026-09-29T10:20:00.000Z',
  updated_at = now()
from public.model_definitions model
where qualification.model_definition_id = model.id;
