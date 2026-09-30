import type { UiJson } from "@/lib/core-ui/workflows";
import { formatDateTime } from "@/lib/core-ui/workflows";

export function ResearchSources({content}:{content:UiJson}) {
  const sources=Array.isArray(content.sources)?content.sources:[];
  if (!sources.length) return null;
  return <div className="researchSources">
    {sources.map((value,index)=>{
      if (!value||typeof value!=="object"||Array.isArray(value)) return null;
      const source=value as Record<string,unknown>;
      if (typeof source.url!=="string"||typeof source.excerpt!=="string") return null;
      let url:URL;try{url=new URL(source.url);}catch{return null;}
      if (url.protocol!=="https:"||url.username||url.password) return null;
      return <article className="researchSourceCard" key={typeof source.id==="string"?source.id:index}>
        <a href={url.toString()} target="_blank" rel="noopener noreferrer">{typeof source.title==="string"?source.title:url.hostname}<span aria-hidden="true"> ↗</span></a>
        <small>{url.hostname} · Retrieved {typeof source.retrievedAt==="string"?formatDateTime(source.retrievedAt):"unknown"}</small>
        <blockquote>{source.excerpt}</blockquote>
        <small>{typeof source.publishedAt==="string"?`Published ${formatDateTime(source.publishedAt)}`:"Publication date unavailable"}</small>
      </article>;
    })}
  </div>;
}
