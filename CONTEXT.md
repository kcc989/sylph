# Sylph

Sylph gives a user durable coding workspaces for projects inside an organization.

## Language

**Organization**:
A membership boundary that owns Projects and is identified to people by a unique slug.

**Project**:
The product a user creates inside an organization. A Project contains one Repository and one or more Workspaces.

**Repository**:
The canonical source history contained by a Project.

**Workspace**:
The durable place where a user works on a Project's Repository with an agent. An initial Workspace is created automatically with its Project.

**Provider connection**:
An Organization-owned authentication method and default model for one AI provider. An Organization can contain several Provider connections and designates one as the default for new and restarted Workspaces.
_Avoid_: OpenCode connection, User connection
