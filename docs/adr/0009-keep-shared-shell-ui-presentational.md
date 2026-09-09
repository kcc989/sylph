# Keep shared shell UI presentational

The UI package supplies shell layout, visual state, and navigation components. The web app handles authentication, routes, active-route selection, and Workspace actions, then passes plain data and links to the components.

This keeps the shell usable in Storybook and other runtimes without dependencies on the application domain or TanStack Router.
