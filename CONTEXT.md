# Sylph

Sylph gives a user durable coding workspaces for projects inside an organization.

## Language

**Organization**:
A membership boundary that owns Projects and is identified to people by a unique slug. Its members are Admins or Users.

**Admin**:
An Organization member who can manage shared settings and Organization connections.

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
An authentication method and default model for one AI provider. An Organization connection is shared with its members; a Personal connection belongs to one User.
_Avoid_: OpenCode connection
