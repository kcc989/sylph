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
The product a user creates inside an organization. A Project contains one Repository and one or more Workspaces.

**Repository**:
The canonical source history contained by a Project.

**Workspace**:
The durable place where a user works on a Project's Repository with an agent. An initial Workspace is created automatically with its Project.

**Provider connection**:
An authentication method and default model for one AI provider. An Organization connection is shared with its members; a Personal connection belongs to one User.
_Avoid_: OpenCode connection
