// ============================================================
//  Cloudflare Worker - 域名导航镜像
//  支持多列表URL + 硬编码域名 + URI过长保护
// ============================================================

const CONFIG = {
    // 远程列表 URL（可配置多个，自动聚合去重）
    LIST_URLS: [
        'https://jfdoc.xingying.us.kg/clra_urls.txt',
        'https://clra1.lzh173.chat/clra_urls.txt',  
    ],
    // 硬编码域名（直接写死，无需网络请求）
    HARDCODED_DOMAINS: [
        'jpt.lzh173.chat',
        'scltk.lzh173.chat',  
    ],
    SITE_TITLE: 'CLRA 导航',
    SEARCH_PLACEHOLDER: '搜索或选择网站...',
    BG_COLOR: '#f0f2f5',
    RATE_LIMIT_PER_MIN: 100,
    DOMAIN_CACHE_TTL: 60,       // 远程列表缓存时间（秒）
    MAX_URL_LENGTH: 15000,      // URL 长度安全阈值（字节）
};

let domainsCache = null;
let lastFetchTime = 0;
const rateLimitMap = new Map();

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (url.pathname === '/') {
            return await handleHomepage();
        }

        return await handleProxy(request, url, env);
    },
};

// ---------- 获取完整域名列表（远程 + 硬编码）----------
async function getDomainList() {
    const now = Date.now();
    
    // 如果缓存有效，直接返回
    if (domainsCache && (now - lastFetchTime) < CONFIG.DOMAIN_CACHE_TTL * 1000) {
        return domainsCache;
    }

    // 开始收集域名
    const domainSet = new Set();

    // 1. 先添加硬编码域名（始终有效）
    CONFIG.HARDCODED_DOMAINS.forEach(d => {
        const cleaned = d.trim();
        if (cleaned) domainSet.add(cleaned);
    });

    // 2. 并行拉取所有远程列表
    const fetchPromises = CONFIG.LIST_URLS.map(async (listUrl) => {
        try {
            const resp = await fetch(listUrl, {
                headers: { 'User-Agent': 'Cloudflare-Worker' },
            });
            if (!resp.ok) {
                console.warn(`列表 ${listUrl} 返回 ${resp.status}`);
                return [];
            }
            const text = await resp.text();
            return text
                .split(/[\s\n]+/)
                .map(s => s.trim())
                .filter(s => s.length > 0);
        } catch (err) {
            console.warn(`列表 ${listUrl} 拉取失败: ${err.message}`);
            return [];
        }
    });

    // 等待所有远程列表（部分失败不影响）
    const results = await Promise.allSettled(fetchPromises);
    
    results.forEach(result => {
        if (result.status === 'fulfilled') {
            result.value.forEach(d => domainSet.add(d));
        }
    });

    // 转为数组并更新缓存
    const domains = Array.from(domainSet);
    domainsCache = domains;
    lastFetchTime = now;

    return domains;
}

// ---------- 首页 ----------
async function handleHomepage() {
    try {
        const domains = await getDomainList();
        const html = buildSearchUI(domains);
        return new Response(html, {
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=300',
            },
        });
    } catch (error) {
        // 即使出错，仍尝试用硬编码域名展示
        const fallbackDomains = CONFIG.HARDCODED_DOMAINS.filter(d => d.trim());
        const html = buildSearchUI(fallbackDomains, true);
        return new Response(html, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
    }
}

function buildSearchUI(domains, isFallback = false) {
    const domainItems = domains.map(d => {
        const isWildcard = d.startsWith('*.');
        const visitLink = isWildcard
            ? `javascript:visitWildcard('${escapeHtml(d)}')`
            : `/proxy/${encodeURIComponent(d)}/`;
        return `<div class="domain-item ${isWildcard ? 'wildcard' : ''}">
                    <span class="domain-name">${escapeHtml(d)}</span>
                    ${isWildcard ? '<span class="badge">泛解析</span>' : ''}
                    <a href="${visitLink}" class="visit-btn">访问</a>
                </div>`;
    }).join('');

    // 构建来源信息
    const sourceInfo = isFallback 
        ? '<div style="color:#ea4335;font-size:12px;">⚠️ 远程列表加载失败，仅显示硬编码域名</div>'
        : `<div style="color:#5f6368;font-size:12px;">
            来源：硬编码 ${CONFIG.HARDCODED_DOMAINS.length} 个 + 远程列表 ${CONFIG.LIST_URLS.length} 个
           </div>`;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${CONFIG.SITE_TITLE}</title>
    <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: -apple-system, sans-serif; background: ${CONFIG.BG_COLOR}; min-height:100vh; display:flex; justify-content:center; padding:40px 20px; }
        .container { max-width:900px; width:100%; }
        .header { text-align:center; margin-bottom:40px; }
        .logo { font-size:48px; font-weight:700; color:#1a73e8; letter-spacing:-1px; margin-bottom:12px; }
        .logo span { color:#ea4335; }
        .search-box { display:flex; max-width:600px; margin:0 auto; background:#fff; border-radius:24px; box-shadow:0 2px 8px rgba(0,0,0,0.08); overflow:hidden; }
        .search-box:focus-within { box-shadow:0 4px 16px rgba(0,0,0,0.15); }
        .search-box input { flex:1; padding:14px 20px; border:none; outline:none; font-size:16px; background:transparent; }
        .search-box button { padding:14px 28px; background:#1a73e8; color:#fff; border:none; font-size:16px; font-weight:500; cursor:pointer; transition:background 0.2s; }
        .search-box button:hover { background:#1557b0; }
        .stats { text-align:center; color:#5f6368; font-size:14px; margin-bottom:24px; }
        .stats strong { color:#1a73e8; }
        .domain-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; }
        .domain-item { display:flex; align-items:center; justify-content:space-between; background:#fff; padding:12px 16px; border-radius:10px; box-shadow:0 1px 4px rgba(0,0,0,0.04); border:1px solid #e8eaed; transition:transform 0.15s,box-shadow 0.15s; }
        .domain-item:hover { transform:translateY(-2px); box-shadow:0 4px 12px rgba(0,0,0,0.08); }
        .domain-name { font-size:14px; color:#202124; font-weight:500; word-break:break-all; flex:1; }
        .badge { font-size:10px; background:#fbbc04; color:#202124; padding:2px 8px; border-radius:12px; font-weight:600; margin:0 8px; white-space:nowrap; }
        .wildcard .domain-name { color:#1a73e8; }
        .visit-btn { display:inline-block; padding:4px 14px; background:#e8f0fe; color:#1a73e8; border-radius:16px; font-size:12px; font-weight:500; text-decoration:none; transition:background 0.2s; white-space:nowrap; margin-left:8px; }
        .visit-btn:hover { background:#d2e3fc; }
        .footer-info { text-align:center; margin-top:40px; }
        @media (max-width:600px) {
            .logo { font-size:32px; }
            .search-box { flex-direction:column; border-radius:16px; }
            .search-box input { padding:12px 16px; }
            .search-box button { padding:12px; border-radius:0 0 16px 16px; }
            .domain-grid { grid-template-columns:1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo">CLRA<span>.</span></div>
            <div class="search-box">
                <input type="text" id="searchInput" placeholder="${CONFIG.SEARCH_PLACEHOLDER}" />
                <button onclick="filterDomains()">🔍 搜索</button>
            </div>
        </div>
        <div class="stats">
            共 <strong id="totalCount">${domains.length}</strong> 个站点
            <span style="margin:0 8px">·</span>
            输入关键词筛选
        </div>
        <div class="domain-grid" id="domainGrid">
            ${domainItems}
        </div>

    </div>

    <script>
        const searchInput = document.getElementById('searchInput');
        const grid = document.getElementById('domainGrid');
        const totalSpan = document.getElementById('totalCount');
        const items = Array.from(grid.querySelectorAll('.domain-item'));

        function filterDomains() {
            const keyword = searchInput.value.toLowerCase().trim();
            let visibleCount = 0;
            items.forEach(item => {
                const name = item.querySelector('.domain-name').textContent.toLowerCase();
                const match = !keyword || name.includes(keyword);
                item.style.display = match ? 'flex' : 'none';
                if (match) visibleCount++;
            });
            totalSpan.textContent = visibleCount;
        }
        searchInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') filterDomains(); });

        function visitWildcard(domainPattern) {
            const suffix = domainPattern.substring(2);
            const random = Math.random().toString(36).substring(2, 8);
            const subdomain = random + '.' + suffix;
            window.location.href = '/proxy/' + encodeURIComponent(subdomain) + '/';
        }
    </script>
</body>
</html>`;
}

// ---------- 代理处理 ----------
async function handleProxy(request, url, env) {
    const pathname = url.pathname;

    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (isRateLimited(clientIP)) {
        return new Response('请求过于频繁，请稍后再试', { status: 429 });
    }

    let domain, targetPath, targetSearch;

    const newFormatMatch = pathname.match(/^\/proxy\/([^\/]+)(\/.*)?$/);
    if (newFormatMatch) {
        domain = decodeURIComponent(newFormatMatch[1]);
        targetPath = newFormatMatch[2] || '/';
        targetSearch = url.search;
    } else {
        const oldMatch = pathname.match(/^\/proxy\/([^\/]+)$/);
        if (!oldMatch) {
            return new Response('无效的代理地址', { status: 400 });
        }
        domain = decodeURIComponent(oldMatch[1]);
        const pathParam = url.searchParams.get('path');
        targetPath = pathParam || '/';
        targetSearch = '';
    }

    const allowedDomains = await getDomainList();
    if (!isDomainAllowed(domain, allowedDomains)) {
        return new Response('此域名不在允许列表中', { status: 403 });
    }

    const targetUrl = new URL(`https://${domain}${targetPath}${targetSearch}`);
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
        return new Response('不支持的协议', { status: 400 });
    }

    if (targetUrl.href.length > CONFIG.MAX_URL_LENGTH) {
        return new Response(
            '目标 URL 过长，无法通过代理访问。请直接访问：<a href="' + targetUrl.href + '">' + targetUrl.href + '</a>',
            { status: 414, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
    }

    const headers = new Headers(request.headers);
    ['cookie', 'authorization', 'x-forwarded-for', 'x-real-ip', 'cf-connecting-ip'].forEach(h => headers.delete(h));
    headers.set('X-Forwarded-Host', domain);

    try {
        const response = await fetch(targetUrl, {
            method: request.method,
            headers: headers,
            body: request.body,
            redirect: 'manual',
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('Location');
            if (location) {
                const newHeaders = new Headers(response.headers);
                newHeaders.set('Location', rewriteRedirect(location, domain));
                return new Response(null, {
                    status: response.status,
                    headers: newHeaders,
                });
            }
        }

        const contentType = response.headers.get('content-type') || '';
        const newHeaders = new Headers(response.headers);
        newHeaders.delete('content-security-policy');
        newHeaders.delete('content-security-policy-report-only');

        if (contentType.includes('text/html')) {
            const rewriter = createHTMLRewriter(domain);
            return rewriter.transform(new Response(response.body, {
                status: response.status,
                headers: newHeaders,
            }));
        } else if (contentType.includes('text/css')) {
            const cssText = await response.text();
            const rewritten = rewriteCSS(cssText, domain);
            return new Response(rewritten, {
                status: response.status,
                headers: newHeaders,
            });
        } else {
            return new Response(response.body, {
                status: response.status,
                headers: newHeaders,
            });
        }
    } catch (error) {
        if (error.message && error.message.includes('URI_TOO_LONG')) {
            return new Response(
                '目标资源链接过长，无法代理。请尝试直接访问：<a href="' + targetUrl.href + '">' + targetUrl.href + '</a>',
                { status: 414, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
            );
        }
        return new Response(`代理失败: ${error.message}`, { status: 502 });
    }
}

// ---------- URL 重写（含长度保护）----------
function rewriteUrl(originalUrl, domain) {
    if (!originalUrl || /^(data|blob|javascript):/i.test(originalUrl)) {
        return originalUrl;
    }
    if (originalUrl.startsWith('/proxy/')) return originalUrl;

    try {
        let urlObj;
        if (originalUrl.startsWith('http://') || originalUrl.startsWith('https://')) {
            urlObj = new URL(originalUrl);
            if (urlObj.hostname !== domain) return originalUrl;
        } else {
            urlObj = new URL(originalUrl, `https://${domain}/`);
        }

        let path = urlObj.pathname;
        const search = urlObj.search;
        if (!path.startsWith('/')) path = '/' + path;
        const proxyUrl = `/proxy/${encodeURIComponent(domain)}${path}${search}`;

        if (proxyUrl.length > CONFIG.MAX_URL_LENGTH) {
            return urlObj.href;
        }
        return proxyUrl;
    } catch {
        return originalUrl;
    }
}

function rewriteSrcset(srcset, domain) {
    return srcset.replace(/([^,\s]\S*?)(\s+\d+[wx])?,?/g, (match, url, descriptor) => {
        if (!url) return match;
        const newUrl = rewriteUrl(url.trim(), domain);
        return descriptor ? `${newUrl} ${descriptor.trim()}` : newUrl;
    });
}

function rewriteInlineStyle(style, domain) {
    return style.replace(/url\(\s*["']?([^)"']+?)["']?\s*\)/g, (match, url) => {
        const newUrl = rewriteUrl(url.trim(), domain);
        return `url(${newUrl})`;
    });
}

function rewriteCSS(cssText, domain) {
    return cssText.replace(/url\(\s*["']?([^)"']+?)["']?\s*\)/g, (match, url) => {
        if (/^(data|#)/i.test(url)) return match;
        const newUrl = rewriteUrl(url.trim(), domain);
        return `url(${newUrl})`;
    });
}

function rewriteRedirect(location, domain) {
    try {
        const absolute = new URL(location, `https://${domain}/`);
        if (absolute.hostname === domain) {
            return rewriteUrl(absolute.pathname + absolute.search, domain);
        }
    } catch {}
    return location;
}

// ---------- HTMLRewriter ----------
function createHTMLRewriter(domain) {
    const rewrite = (val) => rewriteUrl(val, domain);

    return new HTMLRewriter()
        .on('[style]', {
            element(el) {
                const style = el.getAttribute('style');
                if (style && style.includes('url(')) {
                    el.setAttribute('style', rewriteInlineStyle(style, domain));
                }
            }
        })
        .on('a', { element(el) { rewriteAttr(el, 'href', rewrite); } })
        .on('link', { element(el) { rewriteAttr(el, 'href', rewrite); } })
        .on('script', { element(el) { rewriteAttr(el, 'src', rewrite); } })
        .on('img', {
            element(el) {
                rewriteAttr(el, 'src', rewrite);
                const srcset = el.getAttribute('srcset');
                if (srcset) el.setAttribute('srcset', rewriteSrcset(srcset, domain));
            }
        })
        .on('source', {
            element(el) {
                rewriteAttr(el, 'src', rewrite);
                const srcset = el.getAttribute('srcset');
                if (srcset) el.setAttribute('srcset', rewriteSrcset(srcset, domain));
            }
        })
        .on('video', {
            element(el) { rewriteAttr(el, 'src', rewrite); rewriteAttr(el, 'poster', rewrite); }
        })
        .on('audio', { element(el) { rewriteAttr(el, 'src', rewrite); } })
        .on('iframe', { element(el) { rewriteAttr(el, 'src', rewrite); } })
        .on('embed', { element(el) { rewriteAttr(el, 'src', rewrite); } })
        .on('object', { element(el) { rewriteAttr(el, 'data', rewrite); } })
        .on('image', { element(el) { rewriteAttr(el, 'href', rewrite); } })
        .on('form', { element(el) { rewriteAttr(el, 'action', rewrite); } })
        .on('meta', {
            element(el) {
                if (el.getAttribute('http-equiv')?.toLowerCase() === 'refresh') {
                    const content = el.getAttribute('content');
                    if (content) {
                        const newContent = content.replace(/url=([^;]+)/i, (_, url) => 'url=' + rewrite(url.trim()));
                        el.setAttribute('content', newContent);
                    }
                }
            }
        })
        .on('base', { element(el) { el.remove(); } });
}

function rewriteAttr(element, attr, rewriteFn) {
    const val = element.getAttribute(attr);
    if (val) element.setAttribute(attr, rewriteFn(val));
}

// ---------- 域名白名单验证 ----------
function isDomainAllowed(domain, allowed) {
    return allowed.some(pattern => {
        if (pattern === domain) return true;
        if (pattern.startsWith('*.')) {
            const suffix = pattern.slice(2);
            return domain.endsWith('.' + suffix) || domain === suffix;
        }
        return false;
    });
}

// ---------- 限流 ----------
function isRateLimited(ip) {
    const now = Date.now();
    const windowMs = 60_000;
    let entry = rateLimitMap.get(ip);
    if (!entry || (now - entry.reset > windowMs)) {
        entry = { count: 0, reset: now + windowMs };
        rateLimitMap.set(ip, entry);
    }
    entry.count++;
    if (rateLimitMap.size > 1000) {
        for (const [key, val] of rateLimitMap.entries()) {
            if (now - val.reset > windowMs) rateLimitMap.delete(key);
        }
    }
    return entry.count > CONFIG.RATE_LIMIT_PER_MIN;
}

function escapeHtml(text) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return text.replace(/[&<>"']/g, m => map[m]);
}
