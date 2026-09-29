export type ReplayResourceProxy = (absoluteResourceUrl: string) => string;

const URI_ATTRIBUTE = /URI=("([^"]+)"|'([^']+)')/g;

function absoluteResource(resource: string, manifestUrl: string) {
  return new URL(resource, manifestUrl).toString();
}

export function rewriteHlsManifest(
  manifest: string,
  manifestUrl: string,
  proxyResource: ReplayResourceProxy,
) {
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith("#")) {
        return line.replace(
          URI_ATTRIBUTE,
          (_match, quoted: string, doubleQuoted: string, singleQuoted: string) => {
            const resource = doubleQuoted ?? singleQuoted;
            const quote = quoted.startsWith("\"") ? "\"" : "'";
            const proxied = proxyResource(absoluteResource(resource, manifestUrl));
            return `URI=${quote}${proxied}${quote}`;
          },
        );
      }

      const proxied = proxyResource(absoluteResource(trimmed, manifestUrl));
      return line.replace(trimmed, proxied);
    })
    .join("\n");
}
