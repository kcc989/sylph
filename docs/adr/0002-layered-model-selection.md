# Separate Provider authorization from layered model selection

Provider connections contain authorization and model availability but never a chosen model. Sylph resolves the model for a new Conversation from the Organization preference and then the User preference, while a Conversation selection overrides both for subsequent turns; unavailable selections fall back to another usable model with an explanation instead of blocking work. This keeps credentials reusable as model catalogs change and prevents a per-Provider setting from conflating access, defaults, and Conversation state.
