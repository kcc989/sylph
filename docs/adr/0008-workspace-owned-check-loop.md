# Make automatic Check repair optional

Checks, Previews, and browser evidence run only when requested. Saving a Checkpoint or synchronizing a Project Repository does not start them. When a User enables automatic repair, a failed Check starts a normal agent Turn with the failure diagnostics. Other results are recorded without starting a Turn.

Each Workspace allows three consecutive repair Turns. It stores inbox identity and acknowledgements, ignores results for obsolete commits, and protects archived Workspaces. Production Deployments do not start repair Turns.

Acceptance requires a reviewed current Checkpoint. Checks and Previews are optional by default. Configured browser journeys must pass or have a recorded User exception. Managed release and browser evidence are separate options; data restore always requires the full recovery contract. These operations do not provide user-defined event hooks.
