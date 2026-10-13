import arcjet, { shield, detectBot, slidingWindow } from "@arcjet/node";
if(!process.env.ARCJET_KEY && process.env.NODE_ENV !== 'test'){
    throw new Error('ARCJET_KEY env is required');
}

const aj = arcjet({

  // variable rather than hard coding.
  key: process.env.ARCJET_KEY!,
  rules: [
    // Shield protects your app from common attacks such as SQL injection
    shield({ mode: "LIVE" }),
    // Create a bot detection rule
    detectBot({
      mode: "LIVE", // Blocks requests. Use "DRY_RUN" to log only
      // Block all bots except the following
      allow: [
        "CATEGORY:SEARCH_ENGINE", // Google, Bing, etc
        //"CATEGORY:MONITOR", // Uptime monitoring services
        "CATEGORY:PREVIEW", // Link previews such as Slack, Discord
      ],
    }),
    // Max 5 independent req per 2s interval
    slidingWindow({
        mode: 'LIVE',
        interval: '2s',
        max: 5 
    })

  ],
});

export default aj;