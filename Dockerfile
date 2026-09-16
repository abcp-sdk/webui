# syntax=docker/dockerfile:1
# Static host for the webui (Svelte + shadcn) build. Same shape as the Flutter
# web image: nginx on 8080 with an explicit /healthz, real 404s for missing
# assets, and an SPA fallback to index.html.
ARG REGISTRY=forgejo.develop.10.199.64.20.nip.io
FROM ${REGISTRY}/root/alpine:3.24
RUN apk add --no-cache nginx \
    && mkdir -p /run/nginx /usr/share/nginx/html

COPY dist /usr/share/nginx/html

RUN printf 'server {\n\
    listen       8080;\n\
    server_name  localhost;\n\
    root   /usr/share/nginx/html;\n\
    index  index.html;\n\
    location = /index.html { add_header Cache-Control "no-cache"; }\n\
    location = /sw.js { add_header Cache-Control "no-cache"; }\n\
    location = /manifest.webmanifest { add_header Cache-Control "no-cache"; }\n\
    # sqlite-wasm + the OPFS proxy worker must not be rewritten to index.html.\n\
    location ^~ /assets/ { try_files $uri =404; }\n\
    location ~ \\.wasm$ { default_type application/wasm; try_files $uri =404; }\n\
    location ~ \\.(png|svg|ico|webmanifest|ttf|woff2?)$ { try_files $uri =404; }\n\
    location / { try_files $uri $uri/ /index.html; }\n\
    location = /healthz { return 200 "{\\"ok\\":true,\\"name\\":\\"agent-webui\\"}"; add_header Content-Type application/json; }\n\
}\n' > /etc/nginx/http.d/default.conf
RUN sed -i 's|/var/log/nginx/access.log|/dev/stdout|' /etc/nginx/nginx.conf 2>/dev/null || true

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
