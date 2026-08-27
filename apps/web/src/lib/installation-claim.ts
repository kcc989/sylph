type InstallationClaimAccount = {
  email: string
  emailVerified: boolean
}

const normalizeEmail = (email: string) => email.trim().toLowerCase()

export const assertInstallationClaimIdentity = (
  account: InstallationClaimAccount,
  confirmedEmail: string
) => {
  if (!account.emailVerified) {
    throw new Error("Verify your email before claiming this Installation")
  }
  if (normalizeEmail(confirmedEmail) !== normalizeEmail(account.email)) {
    throw new Error("The confirmed email does not match your signed-in account")
  }
}
