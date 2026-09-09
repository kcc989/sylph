# Fork Project templates from imported repositories

A template is a Git repository at a pinned ref. Sylph imports it once per Installation into an Artifacts Template Repository, then forks it for each Project. The Project retains its history and records the template key, repository, and commit. It has no ongoing upstream connection to the template.

The template supplies package scripts and `AGENTS.md`. Deploy stages receive the Project slug as `SYLPH_PROJECT` to generate unique resource names. **Start fresh** forks the built-in default. GitHub imports can remain connected or be copied once. The advanced empty-repository option needs scripts before it can pass a Check.
