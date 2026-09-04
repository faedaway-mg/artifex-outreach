import { chromium, devices } from "playwright";
const BASE="https://outreach.artifexlabs.tech", PW=process.env.OUTREACH_PASSWORD;
async function login(c){const p=await c.newPage();await p.goto(BASE+"/login");await p.fill("#password",PW);await Promise.all([p.waitForURL(u=>!u.pathname.startsWith("/login"),{timeout:20000}).catch(()=>{}),p.click("button[type=submit]")]);await p.waitForLoadState("networkidle").catch(()=>{});return p;}
const b=await chromium.launch();
const c=await b.newContext({viewport:{width:1280,height:900}});const p=await login(c);
await p.goto(BASE+"/content-studio?section=client",{waitUntil:"networkidle"});await p.screenshot({path:"/tmp/studio-desktop.png"});
await p.goto(BASE+"/company/lead_V1lTr7BOZE",{waitUntil:"networkidle"});await p.screenshot({path:"/tmp/company-desktop.png"});
const c2=await b.newContext({...devices["iPhone 13"]});const p2=await login(c2);
await p2.goto(BASE+"/content-studio?section=client",{waitUntil:"networkidle"});await p2.screenshot({path:"/tmp/studio-iphone.png"});
await b.close();console.log("shots done");
