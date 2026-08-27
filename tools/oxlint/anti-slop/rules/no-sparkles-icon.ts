import { defineRule } from "@oxlint/plugins"

import type { ESTree } from "@oxlint/plugins"

const bannedIconNames = new Set(["Sparkle", "Sparkles"])

const importedName = (specifier: ESTree.ImportSpecifier) =>
  specifier.imported.type === "Identifier"
    ? specifier.imported.name
    : specifier.imported.value

const isLucideModule = (source: string) =>
  source === "lucide-react" || source.startsWith("lucide-react/")

const isSparklesModule = (source: string) =>
  isLucideModule(source) && /(?:^|\/)sparkles?(?:\.js)?$/.test(source)

export const noSparklesIconRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Lucide sparkle icons in favor of icons that communicate a specific product concept.",
    },
    messages: {
      sparklesIcon:
        "Replace the sparkle icon with an icon that names the action, object, or status it represents.",
    },
  },
  createOnce(context) {
    const lucideNamespaces = new Set<string>()

    return {
      ImportDeclaration(node) {
        const source = node.source.value

        if (!isLucideModule(source)) return

        if (isSparklesModule(source)) {
          context.report({ node, messageId: "sparklesIcon" })
          return
        }

        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") {
            lucideNamespaces.add(specifier.local.name)
          }

          if (
            specifier.type === "ImportSpecifier" &&
            bannedIconNames.has(importedName(specifier))
          ) {
            context.report({ node: specifier, messageId: "sparklesIcon" })
          }
        }
      },
      ExportNamedDeclaration(node) {
        if (!node.source || !isLucideModule(node.source.value)) return

        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ExportSpecifier" &&
            specifier.local.type === "Identifier" &&
            bannedIconNames.has(specifier.local.name)
          ) {
            context.report({ node: specifier, messageId: "sparklesIcon" })
          }
        }
      },
      JSXMemberExpression(node) {
        if (
          node.object.type === "JSXIdentifier" &&
          lucideNamespaces.has(node.object.name) &&
          bannedIconNames.has(node.property.name)
        ) {
          context.report({ node, messageId: "sparklesIcon" })
        }
      },
    }
  },
})
