# Velora backend

Accounts, wardrobe, photo storage, styling chat, community, admin and notifications.
No `npm install` needed. You only need **Node.js 22.13 or newer** (https://nodejs.org).

## Run it
1. Open a terminal in this folder.
2. `cp .env.example .env` (Windows: copy the file and rename it to `.env`)
3. `npm start`
4. Open http://localhost:3000

Check it works: `npm test` (32 checks, uses a temporary database).

## What works today
- Signup and login (passwords hashed with scrypt, signed HttpOnly session cookie, rate limited)
- Every user only sees their own wardrobe, looks, plan, chat and notifications
- AI Wardrobe Scanner has its own page in the left menu (upload a photo, then your items open in My Wardrobe)
- Settings page (left menu): account settings, personal details, privacy and security (change password, sign out of all devices, download my data, delete account), help and support (FAQ and a message box that reaches the admin page), About Velora
- Profile: photo, bio, member since, wardrobe palette, favourites, style preferences
- Wardrobe: add, edit, delete, favourite, worn counter, dress/shirt and bottom style names (Kalidar, Anarkali, Sharara, Palazzo and more), photo upload (JPG/PNG/WebP, 8 MB, checked)
- Preferences, try-on looks, weekly plan and saved trends (`/api/data/:key`)
- Community: posts, likes, saves, comments, reports, delete own post
- Admin (the `ADMIN_EMAIL` account): stats and report moderation
- Notifications, free weather (`/api/weather?lat=..&lon=..`)

## Virtual try-on
- Three options at the top of the page: **Virtual Try-On** (a model, with Small / Medium / Large size and skin tone choices), **Upload Photo** (the member's own photo wearing her look) and **Look Board** (the real clothes photos together).
- Pieces are chosen from groups (Dress, Abaya or bottom, Scarf, Shoes, Bag, Accessory). A group opens only when tapped. All three looks are always shown under the model, each with Edit, Save and Clear.
- Without any key, Virtual Try-On shows a fashion illustration that follows the style (short or long shirt, palazzo, sharara...) and the chosen size.
- **For a model that looks like a real person:** put model photos in `public/models/`, named `size-skintone.jpg` (for example `small-fair.jpg`, `medium-tan.jpg`, `large-deep.jpg`; sizes small, medium, large; tones fair, light, tan, deep). When a photo matches the chosen size and skin tone, it is shown with a **Dress this model** button, and an image AI key dresses her in the look. See `public/models/README.txt`. Use only photos you have the right to use.
- **Upload Photo** and **Dress this model** need an image AI key in `.env`: `GEMINI_API_KEY` (Google) or `FAL_KEY` (fal.ai). Without a key the screen says it is not switched on yet.
- Each member can make 8 try-ons per hour, to protect your key from overuse.
- The server path is tested with a pretend image service (`npm test`). It was not tested with a real Google or fal.ai key, so the first real try may need a small fix. Quality depends on the service and on a clear, front-facing photo.

## Notifications
- Settings has a **Notifications** tab. Good morning, Good evening and Good night messages each have an on/off switch and a time. Morning is on by default (08:00).
- **Reminders:** the member says what it is (University, Dinner, Wedding...), the date and time, how early to remind her (30 minutes, 1 hour, 3 hours, or the evening before at 9 pm) and whether it repeats (every weekday, every day, every week). The reminder names her planned outfit.
- The server checks every 30 seconds and puts due messages in the bell (using the member's own time zone). They also pop up as device notifications while Velora is open in the browser, once she taps "Allow notifications on this device".
- Not included yet: messages when the browser is closed (that needs a service worker and push keys) and email or phone messages.

## Needs a key from you (not tested here)
- Real wardrobe scan and AI chat: set `ANTHROPIC_API_KEY`. This is a paid service.
- Google sign-in: set `GOOGLE_CLIENT_ID` and send the Google credential to `/api/auth/google`.

## Not done yet
- In `public/index.html`, signup/login, wardrobe, try-on looks, weekly plan, preferences and saved trends now use the server. Community, the admin page, style chat history, wardrobe scan, notifications, saved outfits and the profile also use the server now. With an `ANTHROPIC_API_KEY`, chat and scan use the real AI; without it, chat uses simple built-in rules and scan adds sample items.
- Real try-on (clothes on a photo) needs an image AI service.
- Daily notification sending (a scheduler) and email/phone delivery.
- Before going live: HTTPS, `NODE_ENV=production`, a strong `SESSION_SECRET`, backups of `data/` and `uploads/`.

## VS Code (Windows): easiest way
1. Install Node.js **22 or newer** (the "LTS" button on https://nodejs.org). Close and reopen VS Code afterwards.
2. Unzip `velora-backend.zip` (right click, Extract All). In VS Code: File > Open Folder > choose the `velora-backend` folder. You must see `server.js` in the left list.
3. Either double-click `START-WINDOWS.bat`, or in the VS Code terminal run: `node start.js`
4. Open http://localhost:3000 in the browser. Stop with Ctrl+C.

## If it does not start
- It says Node.js is too old or "No such built-in module: node:sqlite": install Node.js 22 or newer, then run `node -v` to check.
- "Cannot find module" or "package.json not found": VS Code has the wrong folder open. Open the folder that directly contains `server.js`.
- PowerShell says "running scripts is disabled": use `node start.js` instead of `npm start`.
- "Port 3000 is already in use": close the other window (Ctrl+C) or run `set PORT=3001` and start again, then open http://localhost:3001.
- Do not open `public/index.html` by double-clicking it. That shows only the preview, without login or saving. Always open http://localhost:3000.
- Still stuck: copy the red error text from the terminal and send it.
## Home background video
- Home plays a muted looping video behind the headline: your walk-in wardrobe clip (`public/videos/hero1.mp4` and `hero1.webm`). If it is missing, an abstract silk video (`silk.mp4`) plays instead.
- The wardrobe clip is an iStock/Getty preview and has a faint watermark. Buy the clean version before the site goes live.
- To use your own fashion videos: save them as `public/videos/hero1.mp4`, `hero2.mp4`, `hero3.mp4`, `hero4.mp4` (also add a `.webm` with the same name if you can). They play one after the other with a soft fade. If none exist, the silk video plays.
- Best clips: 1080p, 8 to 15 seconds, no sound, under 5 MB each, calm slow motion (silk or lawn fabric moving, hands browsing a wardrobe rail, embroidery close-ups, a dupatta in the wind).
- Make a clip small with ffmpeg: `ffmpeg -i input.mp4 -an -vf scale=1280:-2 -c:v libx264 -crf 28 -movflags +faststart hero1.mp4`
- Visitors who choose "reduce motion" or Data Saver never download the video, and there is a Pause button on the page.

## Page backgrounds
- Every page except Home has its own wardrobe photo behind it (`public/bg/*.webp`), shown clearly like the Home video: My Wardrobe, AI Wardrobe Scanner, Choose Occasion, Weekly Planner, Style Chat, Virtual Try-On, Insights, Trends, Community, Saved and My Profile. Home keeps the video.
- A dark tint sits on top so the light headings stay readable (all text measured at 4.5 contrast or better, even on the brightest part of each photo). Cards stay ivory with dark text.
- To swap a photo, replace the file with the same name (wide picture, about 1600 px, saved as .webp).
- To make a page's photo clearer or darker, change its number in `OVL` inside `public/index.html` (for example `chat: 0.74`). Lower is clearer, higher is darker. Keep it at 0.6 or more so text stays readable.
- Visitors with Data Saver turned on do not load the photos.

## Logo
- The logo is in `public/logo/` (`logo-96.png` for the menu, `logo-192.png` for About, `favicon-32.png` and `favicon-64.png` for the browser tab, `apple-touch-icon.png` for phones). It has a transparent background, so it works best on light backgrounds.
- To change it, replace those files with the same names and sizes.

## Look
- The light theme is caramel and cream; the dark theme is unchanged. The member's choice is remembered.
