export declare const reconcilePrivateBucket: (
  run: (path: string, options?: RequestInit) => Promise<Response>,
  token: string
) => Promise<{ bucketName: string; publicDomain?: string }>
