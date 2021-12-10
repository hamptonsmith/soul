# syntax=docker/dockerfile:1
FROM node:14.17-alpine

RUN mkdir /app
WORKDIR /app

COPY package-lock.json .
COPY package.json .

RUN --mount=type=ssh npm ci

COPY . .

ENTRYPOINT []
CMD ['npm', 'start']
