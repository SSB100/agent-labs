
update public.worker_definitions
set
  input_schema = jsonb_build_object(
    'type','object',
    'additionalProperties',false,
    'required',jsonb_build_array('taskContract','inputArtifacts'),
    'properties',jsonb_build_object(
      'taskContract',jsonb_build_object(
        'type','object',
        'additionalProperties',false,
        'required',jsonb_build_array(
          'id','objective','inputArtifactIds','permittedCapabilities',
          'requiredKnowledge','requiredOutputSchema','completionCriteria',
          'failureCriteria','nonGoals','escalationRules'
        ),
        'properties',jsonb_build_object(
          'id',jsonb_build_object('type','string','format','uuid'),
          'objective',jsonb_build_object('type','string','minLength',1,'maxLength',4000),
          'inputArtifactIds',jsonb_build_object(
            'type','array','minItems',1,'maxItems',1,'uniqueItems',true,
            'items',jsonb_build_object('type','string','format','uuid')
          ),
          'permittedCapabilities',jsonb_build_object(
            'type','array','minItems',1,'uniqueItems',true,
            'items',jsonb_build_object(
              'type','string','enum',jsonb_build_array('browser.observe','browser.interact')
            )
          ),
          'requiredKnowledge',jsonb_build_object(
            'type','array','maxItems',0,'items',jsonb_build_object('type','string')
          ),
          'requiredOutputSchema',jsonb_build_object('type','object'),
          'completionCriteria',jsonb_build_object('type','object'),
          'failureCriteria',jsonb_build_object('type','object'),
          'nonGoals',jsonb_build_object(
            'type','array','minItems',1,'uniqueItems',true,
            'items',jsonb_build_object('type','string')
          ),
          'escalationRules',jsonb_build_object('type','object')
        )
      ),
      'inputArtifacts',jsonb_build_object(
        'type','array','minItems',1,'maxItems',1,
        'items',jsonb_build_object(
          'type','object',
          'additionalProperties',false,
          'required',jsonb_build_array(
            'id','artifactType','name','mediaType','content','metadata'
          ),
          'properties',jsonb_build_object(
            'id',jsonb_build_object('type','string','format','uuid'),
            'artifactType',jsonb_build_object('const','browser.structured-observation'),
            'name',jsonb_build_object('type','string','minLength',1),
            'mediaType',jsonb_build_object('const','application/json'),
            'content',jsonb_build_object('type','object'),
            'metadata',jsonb_build_object('type','object')
          )
        )
      )
    )
  ),
  output_schema = jsonb_build_object(
    'type','object',
    'additionalProperties',false,
    'required',jsonb_build_array(
      'type','elementId','text','url','reason','failureCategory'
    ),
    'properties',jsonb_build_object(
      'type',jsonb_build_object(
        'type','string',
        'enum',jsonb_build_array('click','type','navigate','complete','fail')
      ),
      'elementId',jsonb_build_object('type',jsonb_build_array('string','null')),
      'text',jsonb_build_object('type',jsonb_build_array('string','null')),
      'url',jsonb_build_object('type',jsonb_build_array('string','null')),
      'reason',jsonb_build_object('type','string','minLength',1,'maxLength',500),
      'failureCategory',jsonb_build_object('type',jsonb_build_array('string','null'))
    )
  ),
  updated_at=now()
where id='00000000-0000-4000-8000-000000000904'::uuid;

update public.packs
set
  manifest = manifest
    || jsonb_build_object(
      'inputSchema',(select input_schema from public.worker_definitions where id='00000000-0000-4000-8000-000000000904'::uuid),
      'outputSchema',(select output_schema from public.worker_definitions where id='00000000-0000-4000-8000-000000000904'::uuid)
    ),
  updated_at=now()
where id='00000000-0000-4000-8000-000000000903'::uuid;

select private.stage9_refresh_planner_qualification();

comment on column public.worker_definitions.output_schema is
  'Pinned Worker output JSON Schema. Browser Planner version 1.0.0 exactly matches the source Worker Pack schema.';
