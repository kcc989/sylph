"use client"

import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

function ResponseMarkdown({ children }: { children: string }) {
  return (
    <div className="min-w-0 text-[13px] leading-5 text-foreground/80 [&_a]:font-medium [&_a]:text-[#ef9b7e] [&_a]:underline [&_a]:decoration-[#ef9b7e]/40 [&_a]:underline-offset-2 [&_blockquote]:my-3 [&_blockquote]:border-l [&_blockquote]:border-white/15 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded-[4px] [&_code]:bg-white/[.07] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground/90 [&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:tracking-[-0.02em] [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-[13px] [&_h3]:font-semibold [&_hr]:my-4 [&_hr]:border-white/10 [&_li]:pl-0.5 [&_ol]:my-2 [&_ol]:grid [&_ol]:list-decimal [&_ol]:gap-1 [&_ol]:pl-5 [&_p+p]:mt-3 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-white/[.08] [&_pre]:bg-black/25 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_td]:border-b [&_td]:border-white/[.07] [&_td]:px-2 [&_td]:py-1.5 [&_th]:border-b [&_th]:border-white/15 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium [&_ul]:my-2 [&_ul]:grid [&_ul]:list-disc [&_ul]:gap-1 [&_ul]:pl-5 [&>:first-child]:mt-0 [&>:last-child]:mb-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}

export { ResponseMarkdown }
