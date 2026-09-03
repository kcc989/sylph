# Sylph

Sylph gives people durable coding workspaces for Projects inside an Installation.

## Language

**Installation**:
A deployed Sylph system operated as one security and data boundary. An Installation contains one Organization.

**Installation claim**:
The one-time act that creates the Installation's Organization and makes an authenticated claimant with a verified, explicitly confirmed email its first Admin.

**Organization**:
A membership boundary that owns Projects inside an Installation. Its members are Admins or Users.

**Admin**:
An Organization member who can invite Users and manage shared settings and Provider connections.

**Invitation**:
An Admin-issued authorization for one email address to become a User. After the Installation is claimed, a new User can exist only when a current Invitation authorizes their email address.

**User**:
An Organization member who can work in its Projects and manage their own personal connections.

**Project**:
The product a user creates inside an organization. A Project contains one Project Repository and one or more Workspaces.

**Skill**:
Reusable instructions and supporting resources that guide an Agent. A Skill can allow user slash invocation, model invocation, both, or neither.

**Skill Installation**:
A durable attachment of a Skill to an Installation or Project. A Project Skill with the same name overrides the Installation Skill for that Project.

**Project Repository**:
The accepted source history for a Project. A Project has exactly one Project Repository.

**Template Repository**:
An imported source history, pinned to one commit, from which a Project Repository can be forked. An Installation imports each template ref once.

**Template origin**:
The Template Repository and commit a Project Repository was forked from. A Project keeps no live link to its template.

**Upstream Repository**:
An external GitHub Repository connected to a Project Repository for ongoing synchronization and delivery. It is not the accepted source history inside Sylph.

**Delivery**:
Publication of an Accepted commit to an Upstream Repository by direct push or pull request.

**Recovery export**:
A manifest containing every Git Repository needed to recover a Project, including its Project Repository and retained Workspace forks.

**Workspace**:
The durable place where a user works with an agent in an isolated Workspace fork. An archived Workspace is retained with its history but is read-only.

**Discard**:
The irreversible removal of a Workspace, its Workspace fork, and its Working copy.

**Workspace fork**:
The independent source history owned by one Workspace and created from a Project Repository.

**Working copy**:
The mutable files inside a Workspace, including work not yet saved as a Checkpoint.

**Checkpoint**:
A durable commit that records the Working copy in the Workspace fork.

**Check**:
An evaluation of one exact Checkpoint through the Project's install, typecheck, lint, test, and build requirements. A Check may also create and test that Checkpoint's Preview.

**Preview**:
An isolated deployment of one exact Checkpoint that can be inspected by a User or a browser test.

**Evidence**:
A durable observation captured while testing a Preview, such as a screenshot or accessibility snapshot, and linked to the Check that produced it.

**Acceptance**:
The User's decision to merge a checked Checkpoint from a Workspace fork into the Project Repository.

**Base commit**:
The exact Project Repository commit from which a Workspace fork was created.

**Fork head**:
The latest Checkpoint commit in a Workspace fork.

**Accepted commit**:
The commit in the Project Repository containing accepted Workspace work.

**Deployment**:
A durable record of one attempt to publish an Accepted commit to production. A Deployment belongs to a Project and does not change its Project Repository.

**Rollback**:
A new Deployment of an earlier Accepted commit. A Rollback does not move or rewrite the Project Repository.

**Provider connection**:
Authorization for one AI provider together with the models currently available through it. An Organization connection is shared with its members; a Personal connection belongs to one User.
_Avoid_: OpenCode connection

**Model preference**:
A preferred Provider model chosen for an Organization or a User. A User preference overrides the Organization preference without changing either Provider connection.
_Avoid_: Default Provider

**Conversation**:
The durable sequence of user and agent turns inside a Workspace. A Conversation may select a model independently of its User and Organization preferences.

**Turn**:
One agent execution inside a Conversation. A Turn ends when it succeeds, fails, or is interrupted.

**Queued message**:
A durable User message that starts a new Turn after the active Turn ends.

**Steering message**:
A durable User message delivered to the agent during the active Turn to change its direction.

**Agent question**:
A durable request for structured User input during a Turn. It remains answerable after the User leaves or reloads the Workspace.

**Conversation model selection**:
The model used for the next agent turn in one Conversation. It overrides User and Organization preferences without changing them or rewriting earlier turns.
