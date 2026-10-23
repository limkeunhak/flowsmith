// swagger-ui-dist는 타입이 없다 — 쓰는 것만
declare module "swagger-ui-dist/swagger-ui-es-bundle.js" {
  const SwaggerUIBundle: (opts: Record<string, unknown> & { domNode: HTMLElement; url: string }) => unknown;
  export default SwaggerUIBundle;
}
declare module "swagger-ui-dist/swagger-ui.css";
