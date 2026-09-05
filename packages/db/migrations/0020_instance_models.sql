ALTER TABLE installation ADD COLUMN model_policy TEXT NOT NULL DEFAULT '{"models":[],"defaultModel":null}';
UPDATE installation SET model_policy = COALESCE((
  SELECT json_object(
    'models', json_array(json_object('providerId', preference.provider_id, 'modelId', preference.model_id)),
    'defaultModel', json_object('providerId', preference.provider_id, 'modelId', preference.model_id)
  ) FROM organization_model_preference preference
  WHERE preference.organization_id = installation.organization_id
), model_policy);
