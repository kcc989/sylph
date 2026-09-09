# Separate Provider authorization from model selection

A Provider connection stores authorization and available models. Model preferences are separate: the Organization sets the default, the User can override it, and a Conversation can override both for later Turns. If a selected model becomes unavailable, Sylph chooses another usable model and explains the change.

This separation lets model preferences change without replacing credentials or changing other Conversations.
