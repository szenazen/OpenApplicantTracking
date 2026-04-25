# Minimal nginx reverse proxy for local / compose — see nginx.conf
FROM nginx:1.27-alpine
COPY services/api-gateway/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
