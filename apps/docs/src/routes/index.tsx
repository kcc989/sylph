import { Link, createFileRoute } from "@tanstack/react-router"
import { HomeLayout } from "fumadocs-ui/layouts/home"
import {
  ArrowRight,
  Boxes,
  CircleCheck,
  Cloud,
  Container,
  Database,
  GitBranch,
  Globe,
  HardDrive,
  Radio,
  Workflow,
} from "lucide-react"
import type { ComponentType } from "react"

import { SylphLogo } from "@/components/sylph-logo"
import { homeLayoutOptions } from "@/lib/layout"
import { repositoryUrl } from "@/lib/site"

export const Route = createFileRoute("/")({
  component: MarketingHome,
})

const platform: {
  icon: ComponentType<{ className?: string }>
  product: string
  role: string
}[] = [
  {
    icon: Cloud,
    product: "Workers",
    role: "One Worker serves the TanStack Start UI, the authenticated server functions, and the deployment broker.",
  },
  {
    icon: Radio,
    product: "Durable Objects",
    role: "One object owns one Workspace: the agent host, the working copy, turn ordering, and hibernatable WebSockets.",
  },
  {
    icon: Database,
    product: "D1",
    role: "The control plane. Organizations, Projects, Workspaces, Check indexes, and settings that must be queried across users.",
  },
  {
    icon: GitBranch,
    product: "Artifacts",
    role: "The canonical code store. One repository per Project, one fork per Workspace, forks merged on Acceptance.",
  },
  {
    icon: Container,
    product: "Containers",
    role: "Cloudflare CI Sandboxes run install, typecheck, lint, test, build, and deploy outside the agent runtime.",
  },
  {
    icon: Workflow,
    product: "Workflows",
    role: "Retryable steps drive provisioning, Checks, merges, message delivery, and retention to completion.",
  },
  {
    icon: HardDrive,
    product: "R2",
    role: "Dependency snapshots, Check backups, and the screenshots captured as Evidence.",
  },
  {
    icon: Globe,
    product: "Browser Rendering",
    role: "The agent opens its own Preview, reads the accessibility tree, and stores a screenshot against the Check.",
  },
]

const lifecycle: { step: string; title: string; body: string }[] = [
  {
    step: "01",
    title: "Direct",
    body: "You open a Workspace and describe the change. The agent reasons, searches, and edits inside the Durable Object.",
  },
  {
    step: "02",
    title: "Checkpoint",
    body: "The Working copy is committed to the Workspace fork, so every later step names one exact commit.",
  },
  {
    step: "03",
    title: "Check",
    body: "Cloudflare CI installs, typechecks, lints, tests, and builds that commit. A failed Check can start a bounded repair turn.",
  },
  {
    step: "04",
    title: "Preview",
    body: "The same commit is deployed in isolation. The agent drives it in a real browser and stores the screenshots as Evidence.",
  },
  {
    step: "05",
    title: "Accept",
    body: "You merge the checked Checkpoint into the Project Repository. Nothing reaches the Project without a Check.",
  },
  {
    step: "06",
    title: "Deploy",
    body: "An Accepted commit is published to production, and any earlier Accepted commit can be redeployed as a Rollback.",
  },
]

const principles: { title: string; body: string }[] = [
  {
    title: "Your account, your data",
    body: "An Installation is one security and data boundary in your own Cloudflare account. There is no Sylph-hosted tier to route your code through.",
  },
  {
    title: "Parallel by construction",
    body: "Every Workspace owns an isolated fork and its own agent host, so concurrent work never shares a mutable branch or a working tree.",
  },
  {
    title: "Proof, not promises",
    body: "A Checkpoint is only acceptable after a Check on that exact commit. Previews and browser Evidence are attached to the run that produced them.",
  },
  {
    title: "Recoverable by design",
    body: "A Recovery export lists every Git repository needed to rebuild a Project, including retained Workspace forks.",
  },
]

function MarketingHome() {
  return (
    <HomeLayout {...homeLayoutOptions} className="flex-1">
      <Hero />
      <PlatformSection />
      <LifecycleSection />
      <PrinciplesSection />
      <ClosingSection />
    </HomeLayout>
  )
}

function Hero() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-6 py-20 sm:py-28">
        <SylphLogo className="h-10 w-auto self-start text-foreground" />
        <p className="text-xs font-medium tracking-[0.2em] text-primary uppercase">
          Apache-2.0 · Cloudflare-native
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold text-balance sm:text-5xl">
          Full stack development that lives on the Cloudflare developer
          platform.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Sylph gives coding agents durable cloud Workspaces. The editor, the
          source history, the build, the preview, and the production deploy all
          run on Cloudflare primitives inside one Installation you operate
          yourself.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/docs"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Read the documentation
            <ArrowRight className="size-4" />
          </Link>
          <Link
            to="/docs/$"
            params={{ _splat: "getting-started/deploy-an-installation" }}
            className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-accent"
          >
            Deploy an Installation
          </Link>
          <a
            href={repositoryUrl}
            className="inline-flex h-10 items-center rounded-md px-4 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            View the source
          </a>
        </div>
      </div>
    </section>
  )
}

function PlatformSection() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <SectionHeading
          eyebrow="The stack"
          title="Every layer is a Cloudflare primitive"
          body="Sylph is not a container platform with a Cloudflare deploy target bolted on. Each part of the product maps onto the service that fits it."
        />
        <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
          {platform.map((entry) => (
            <div key={entry.product} className="bg-card p-5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <entry.icon className="size-4 text-primary" />
                {entry.product}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{entry.role}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function LifecycleSection() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <SectionHeading
          eyebrow="The loop"
          title="From a prompt to a production deploy"
          body="One Workspace keeps the agent, the running product, and the proof in the same place. Nothing is accepted on trust."
        />
        <ol className="mt-10 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {lifecycle.map((entry) => (
            <li key={entry.step} className="bg-card p-5">
              <span className="font-mono text-xs text-primary">
                {entry.step}
              </span>
              <h3 className="mt-2 text-sm font-medium">{entry.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{entry.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function PrinciplesSection() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        <SectionHeading
          eyebrow="Why it is built this way"
          title="Operator-owned, parallel, and provable"
        />
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {principles.map((entry) => (
            <div key={entry.title} className="flex gap-3">
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              <div>
                <h3 className="text-sm font-medium">{entry.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {entry.body}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function ClosingSection() {
  return (
    <section>
      <div className="mx-auto w-full max-w-5xl px-6 py-20">
        <div className="rounded-lg border border-border bg-card p-8">
          <Boxes className="size-5 text-primary" />
          <h2 className="mt-4 text-2xl font-semibold">
            Deploy one Installation into your own account
          </h2>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Fork the repository, run the Deploy production workflow with a
            Cloudflare account ID, a deploy token, and a setup code, then claim
            the Installation from the setup screen. No local toolchain is
            required.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/docs/$"
              params={{ _splat: "getting-started/deploy-an-installation" }}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Deployment guide
              <ArrowRight className="size-4" />
            </Link>
            <Link
              to="/docs/$"
              params={{ _splat: "cloudflare/architecture" }}
              className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-accent"
            >
              Read the architecture
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

function SectionHeading({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string
  title: string
  body?: string
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-medium tracking-[0.2em] text-primary uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-3 text-2xl font-semibold text-balance sm:text-3xl">
        {title}
      </h2>
      {body ? <p className="mt-3 text-muted-foreground">{body}</p> : null}
    </div>
  )
}
