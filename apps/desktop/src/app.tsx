import { useEffect, useRef, useState } from "react"
import type { FormEvent } from "react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"

import {
  canSubmit,
  connectingState,
  failureMessage,
  initialConnectState,
  stateAfterConnect,
  stateAfterEdit,
  stateAfterRead,
  submitLabel,
  submittedAddress,
} from "./connect-form"
import type { ConnectState } from "./connect-form"
import { installationConnect, installationRead } from "./installation"

const addressFieldId = "installation-address"
const addressErrorId = "installation-address-error"

const SylphMark = ({ className }: { className: string }) => (
  <svg
    aria-hidden="true"
    className={className}
    fill="currentColor"
    viewBox="0 0 24 24"
  >
    <g transform="translate(0.75 -1.15)">
      <path d="M19 3.1L20 6.6C18.5 7.05 16.8 7.15 14.8 7.7L8.5 9.3C7.4 9.6 6.8 10.3 6.8 11.2C6.8 12.3 7.6 12.7 8.6 12.4L14.5 10.8C18.7 9.7 21 11 21 14.2C21 17.5 17.3 19.7 12.8 21.1L4.6 23.2L3.6 19.7L13 17.2C14.6 16.8 15.4 16.3 15.4 15.3C15.4 14.1 14.8 13.8 13.7 14.1L8 15.6C3.8 16.7 1.5 15.2 1.5 12C1.5 8.4 5 6.5 10.3 5.2L16.7 3.6C17.7 3.35 18.5 3.22 19 3.1Z" />
    </g>
  </svg>
)

export const App = () => {
  const [address, setAddress] = useState("")
  const [state, setState] = useState<ConnectState>(initialConnectState)
  const addressField = useRef<HTMLInputElement>(null)

  useEffect(() => {
    addressField.current?.focus()
  }, [])

  useEffect(() => {
    let listening = true
    installationRead().then((outcome) => {
      if (listening) setState(stateAfterRead(outcome))
    })
    return () => {
      listening = false
    }
  }, [])

  const connect = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit(address, state)) return
    setState(connectingState)
    installationConnect(submittedAddress(address)).then((outcome) => {
      const next = stateAfterConnect(outcome)
      setState(next)
      if (next.status === "failed") addressField.current?.focus()
    })
  }

  const message = failureMessage(state)

  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6 py-12 text-foreground">
      <section
        aria-labelledby="connect-title"
        className="w-full max-w-sm rounded-lg border bg-card p-6"
      >
        <div className="grid size-7 place-items-center rounded-[6px] border border-white/10 bg-primary text-primary-foreground">
          <SylphMark className="size-4" />
        </div>
        <h1
          id="connect-title"
          className="mt-5 text-xl font-semibold tracking-[-0.03em]"
        >
          Connect to your Installation
        </h1>
        <form className="mt-6 grid gap-2" noValidate onSubmit={connect}>
          <Label htmlFor={addressFieldId}>Installation address</Label>
          <Input
            id={addressFieldId}
            name="installationAddress"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder="https://sylph.example.workers.dev"
            ref={addressField}
            value={address}
            aria-invalid={message !== null}
            aria-describedby={message === null ? undefined : addressErrorId}
            onChange={(event) => {
              setAddress(event.target.value)
              setState(stateAfterEdit)
            }}
          />
          {message === null ? null : (
            <p
              id={addressErrorId}
              role="alert"
              className="text-xs leading-5 text-destructive"
            >
              {message}
            </p>
          )}
          <Button
            type="submit"
            className="mt-2"
            disabled={!canSubmit(address, state)}
          >
            {submitLabel(state)}
          </Button>
        </form>
        <p className="mt-5 text-xs leading-5 text-muted-foreground">
          Enter the address of a deployed Sylph Installation.
        </p>
      </section>
    </main>
  )
}
