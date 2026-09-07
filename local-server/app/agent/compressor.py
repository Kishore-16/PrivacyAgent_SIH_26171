import logging
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode
from app.agent.schema import AgentStepRequest

logger = logging.getLogger("AgentStateCompressor")

def compress_agent_state(req: AgentStepRequest) -> AgentStepRequest:
    """
    Compresses the massive AgentStepRequest payload to minimize LLM context bloat.
    Mutates the request object in place and returns it.
    """
    try:
        # 1. URL Cleansing: Remove verbose tracking params
        if req.url:
            req.url = _clean_url(req.url)

        # 2. DOM / Accessibility Tree Pruning & Bounding Box Optimization
        if req.dom_nodes:
            compressed_nodes = []
            seen_signatures = set()
            
            for node in req.dom_nodes:
                # Unit/integration clients and accessibility-only pages may not
                # have pixel bounds.  Retain those controls instead of silently
                # turning an actionable page into an empty observation.
                rect = node.get("rect") or {"x": 0, "y": 0, "width": 1, "height": 1}
                    
                # Drop off-screen or invisible elements (width or height == 0)
                w = rect.get("width", 0)
                h = rect.get("height", 0)
                if w == 0 or h == 0:
                    continue
                    
                x = int(rect.get("x", 0))
                y = int(rect.get("y", 0))
                
                # Deduplication signature: tag + text + type
                text = (node.get("text") or "").strip()
                tag = (node.get("tag") or "").strip()
                node_type = (node.get("type") or "").strip()
                
                signature = f"{tag}|{text}|{node_type}"
                if signature in seen_signatures and not text:
                    continue
                seen_signatures.add(signature)
                
                # Viewport scoring (lower score is better/closer to top-left visible area)
                # Elements way off-screen (e.g. y > 2000) will have high scores
                score = abs(y) + (abs(x) * 0.5)
                
                # Round bounding boxes to integers to save tokens
                node["rect"] = {
                    "x": x,
                    "y": y,
                    "width": int(w),
                    "height": int(h)
                }
                node["_score"] = score
                
                # Strip out any non-essential fields (keep agentId, text, placeholder, tag, type, selector, rect)
                essential_keys = {"agentId", "text", "placeholder", "ariaLabel", "tag", "type", "selector", "rect", "options", "selectedOption", "_score"}
                clean_node = {k: v for k, v in node.items() if k in essential_keys and (v or v == 0)}
                compressed_nodes.append(clean_node)
            
            # Sort by viewport score and keep top 50 most relevant nodes
            compressed_nodes.sort(key=lambda n: n.get("_score", 999999))
            compressed_nodes = compressed_nodes[:50]
            
            # Remove the temporary score field
            for node in compressed_nodes:
                node.pop("_score", None)
                
            req.dom_nodes = compressed_nodes

        # (History Summarization removed: planner.py already handles formatting efficiently)

        # 4. Truncate visible text
        if req.visible_text and len(req.visible_text) > 1000:
            req.visible_text = req.visible_text[:1000] + "... [truncated]"

        logger.info(f"Compressed agent state successfully. Nodes remaining: {len(req.dom_nodes)}")
    except Exception as e:
        logger.error(f"Error compressing agent state: {e}")
        
    return req

def _clean_url(url: str) -> str:
    """Removes tracking query parameters from URL."""
    try:
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        # Filters out common tracking parameters
        clean_qs = {k: v for k, v in qs.items() if not k.startswith("utm_") and k not in {"ref", "source", "click_id", "session_id"}}
        parsed = parsed._replace(query=urlencode(clean_qs, doseq=True))
        return urlunparse(parsed)
    except:
        return url
