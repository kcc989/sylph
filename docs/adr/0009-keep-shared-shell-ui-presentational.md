# Keep shared shell UI presentational

The shared UI package owns shell layout, visual state, and presentational navigation data. The web app owns authentication, route construction, active-route selection, and Workspace actions, then supplies plain data and links to the UI package. This boundary keeps the shell reusable in Storybook and other runtimes without coupling shared components to the application domain or TanStack Router.
