#!/usr/bin/env python3
"""
One-click deploy for Vite dist -> Nginx (SPA) on nginx/1.22.x.

What it does:
1) npm run build (optional)
2) Sync dist/ -> /var/www/<site>/
3) Write nginx vhost config (SPA try_files + assets cache + gzip)
4) Enable site (Debian-style sites-enabled OR conf.d fallback)
5) nginx -t && systemctl reload nginx

Run:
  sudo python3 deploy_vite_nginx.py --site whale-vault --domain whale3070.com --project /root/git-connect-helper-edbe1c7c

Optional API reverse proxy:
  sudo python3 deploy_vite_nginx.py --site whale-vault --domain whale3070.com --project /root/git-connect-helper-edbe1c7c --api http://127.0.0.1:8080 --api-prefix /api/
"""

import argparse
import os
import shutil
import subprocess
from pathlib import Path
from textwrap import dedent


def run(cmd, check=True, cwd=None):
    print(f"\n$ {' '.join(cmd)}")
    return subprocess.run(cmd, check=check, cwd=cwd)


def must_root():
    if os.geteuid() != 0:
        raise SystemExit("❌ Please run as root (use sudo).")


def which_or_die(bin_name: str):
    if shutil.which(bin_name) is None:
        raise SystemExit(f"❌ Missing dependency: {bin_name}")


def detect_nginx_layout():
    """
    Returns:
      layout: "debian" if /etc/nginx/sites-available exists, else "conf.d"
      avail_dir, enabled_dir_or_conf_d
    """
    nginx_dir = Path("/etc/nginx")
    sites_available = nginx_dir / "sites-available"
    sites_enabled = nginx_dir / "sites-enabled"
    conf_d = nginx_dir / "conf.d"

    if sites_available.exists() and sites_enabled.exists():
        return "debian", sites_available, sites_enabled
    if conf_d.exists():
        return "conf.d", conf_d, conf_d
    raise SystemExit("❌ Cannot find nginx config dirs (/etc/nginx/sites-available or /etc/nginx/conf.d).")


def write_file(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(path)
    print(f"✅ Wrote {path}")


def render_nginx_conf(server_name: str, web_root: str, api_upstream: str | None, api_prefix: str):
    # Normalize api_prefix
    if not api_prefix.startswith("/"):
        api_prefix = "/" + api_prefix
    if not api_prefix.endswith("/"):
        api_prefix = api_prefix + "/"

    api_block = ""
    if api_upstream:
        # Ensure upstream has scheme
        if not (api_upstream.startswith("http://") or api_upstream.startswith("https://")):
            api_upstream = "http://" + api_upstream

        api_block = dedent(f"""
            # Reverse proxy to backend
            location {api_prefix} {{
                proxy_pass {api_upstream};
                proxy_set_header Host $host;
                proxy_set_header X-Real-IP $remote_addr;
                proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                proxy_set_header X-Forwarded-Proto $scheme;

                # WebSocket (safe even if unused)
                proxy_http_version 1.1;
                proxy_set_header Upgrade $http_upgrade;
                proxy_set_header Connection "upgrade";
            }}
        """)

    return dedent(f"""
    server {{
        listen 80;
        server_name {server_name};

        root {web_root};
        index index.html;

        access_log /var/log/nginx/{server_name}.access.log;
        error_log  /var/log/nginx/{server_name}.error.log;

        # SPA routing: avoid 404 on refresh for React/Vue Router
        location / {{
            try_files $uri $uri/ /index.html;
        }}

        # Cache hashed assets aggressively
        location /assets/ {{
            expires 1y;
            add_header Cache-Control "public, immutable";
            try_files $uri =404;
        }}

        # gzip (Vite already produces compressible assets)
        gzip on;
        gzip_min_length 1024;
        gzip_types
            text/plain
            text/css
            application/javascript
            application/json
            application/xml
            image/svg+xml;

        add_header X-Content-Type-Options nosniff;
        add_header X-Frame-Options SAMEORIGIN;
        add_header Referrer-Policy strict-origin-when-cross-origin;
    {api_block}
    }}
    """).strip() + "\n"


def rsync_dist(dist_dir: Path, target_dir: Path):
    target_dir.mkdir(parents=True, exist_ok=True)
    # Use rsync if available; otherwise shutil copytree
    if shutil.which("rsync"):
        run(["rsync", "-av", "--delete", f"{str(dist_dir)}/", f"{str(target_dir)}/"])
    else:
        # Fallback: remove and copy
        if target_dir.exists():
            for child in target_dir.iterdir():
                if child.is_dir():
                    shutil.rmtree(child)
                else:
                    child.unlink()
        for child in dist_dir.iterdir():
            dst = target_dir / child.name
            if child.is_dir():
                shutil.copytree(child, dst)
            else:
                shutil.copy2(child, dst)
    # Permissions: readable by nginx
    for p in target_dir.rglob("*"):
        if p.is_dir():
            p.chmod(0o755)
        else:
            p.chmod(0o644)
    target_dir.chmod(0o755)


def main():
    must_root()
    which_or_die("nginx")

    ap = argparse.ArgumentParser()
    ap.add_argument("--project", required=True, help="Project root path (contains package.json and dist/)")
    ap.add_argument("--site", default="whale-vault", help="Site folder name under /var/www/")
    ap.add_argument("--domain", default="_", help="server_name (domain). Use _ if none.")
    ap.add_argument("--skip-build", action="store_true", help="Skip npm run build")
    ap.add_argument("--api", default=None, help="Backend upstream, e.g. http://127.0.0.1:8080")
    ap.add_argument("--api-prefix", default="/api/", help="API path prefix to proxy, default /api/")
    args = ap.parse_args()

    project = Path(args.project).resolve()
    if not (project / "package.json").exists():
        raise SystemExit(f"❌ package.json not found in {project}")
    dist_dir = project / "dist"
    if not args.skip_build:
        # Prefer npm if present; you can change to pnpm/yarn by editing here
        which_or_die("npm")
        run(["npm", "run", "build"], cwd=str(project))

    if not dist_dir.exists():
        raise SystemExit(f"❌ dist/ not found at {dist_dir}. Build may have failed.")

    # Deploy dist
    web_root = Path("/var/www") / args.site
    rsync_dist(dist_dir, web_root)
    print(f"✅ Synced dist -> {web_root}")

    # Write nginx config
    layout, avail_dir, enabled_dir = detect_nginx_layout()
    server_name = args.domain.strip() or "_"

    if layout == "debian":
        conf_path = avail_dir / f"{args.site}.conf"
        enabled_link = enabled_dir / f"{args.site}.conf"
    else:
        conf_path = avail_dir / f"{args.site}.conf"
        enabled_link = conf_path  # same dir for conf.d

    conf = render_nginx_conf(server_name=server_name, web_root=str(web_root), api_upstream=args.api, api_prefix=args.api_prefix)
    write_file(conf_path, conf)

    # Enable (Debian)
    if layout == "debian":
        if enabled_link.is_symlink() or enabled_link.exists():
            enabled_link.unlink(missing_ok=True)
        enabled_link.symlink_to(conf_path)
        print(f"✅ Enabled site: {enabled_link} -> {conf_path}")

        # Optionally disable default to avoid conflicts
        default = enabled_dir / "default"
        if default.exists():
            print(f"ℹ️ Found {default}; leaving it as-is. If you see conflicts, remove it manually.")

    # Test and reload
    run(["nginx", "-t"])
    # reload via systemctl if available, else nginx -s reload
    if shutil.which("systemctl"):
        run(["systemctl", "reload", "nginx"])
    else:
        run(["nginx", "-s", "reload"])

    print("\n🎉 Done!")
    print(f"- Web root: {web_root}")
    print(f"- Nginx conf: {conf_path}")
    print("Test locally:")
    print("  curl -I http://127.0.0.1/")
    if server_name != "_":
        print(f"  curl -I http://{server_name}/")


if __name__ == "__main__":
    main()
