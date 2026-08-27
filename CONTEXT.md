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

**Project Repository**:
The accepted source history for a Project. A Project has exactly one Project Repository.

**Workspace**:
The durable place where a user works with an agent in an isolated Workspace fork. An initial Workspace is created automatically with its Project.

**Workspace fork**:
The independent source history owned by one Workspace and created from a Project Repository.

**Working copy**:
The mutable files inside a Workspace, including work not yet saved as a Checkpoint.

**Checkpoint**:
A durable commit that records the Working copy in the Workspace fork.

**Base commit**:
The exact Project Repository commit from which a Workspace fork was created.

**Fork head**:
The latest Checkpoint commit in a Workspace fork.

**Accepted commit**:
The commit in the Project Repository containing accepted Workspace work.

**Provider connection**:
Authorization for one AI provider together with the models currently available through it. An Organization connection is shared with its members; a Personal connection belongs to one User.
_Avoid_: OpenCode connection

**Model preference**:
A preferred Provider model chosen for an Organization or a User. A User preference overrides the Organization preference without changing either Provider connection.
_Avoid_: Default Provider

**Conversation**:
The durable sequence of user and agent turns inside a Workspace. A Conversation may select a model independently of its User and Organization preferences.

**Conversation model selection**:
The model used for the next agent turn in one Conversation. It overrides User and Organization preferences without changing them or rewriting earlier turns.
