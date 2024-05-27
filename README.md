This is deliberately not my best work. There's no database, login system, unit tests, undo button, replay, multi-game support, or any attempt at reducing the excessive network requests. The goal was to put together a simple LAN game that I could host on my phone, which will be configured as a mobile hotspot in an area where there's no signal, in two days, and that's what I did. I was able to host it with [Dory-node.js](https://play.google.com/store/apps/details?id=io.tempage.dorynode&hl=en_US&gl=US), complete with its 3 year old NodeJS version, and I had to sideload the APK, but I ended up liking that app quite a bit.

I used [GPT-4o](https://chatgpt.com/) for most of the story content and much of the initial code. It probably saved me a full day of work on the initial HTML, CSS, and AJAX. Regarding the story, I handled the overarching concept, plot twist, compressing the 27 chapters a bit, and some sentencs; the outline and bulk of the writing were generated by ChatGPT. I always hesitate to share messages I didn't specifically intend for public consumption, but [here's the main chat session](https://chatgpt.com/share/97a1106e-7033-4f85-a447-79566db57f95). I asked a lot more specific questions like "could you restyle this button?" in separate sessions.

I also used Stable Diffusion XL via [Automatic1111's stable-diffusion-webui](https://github.com/AUTOMATIC1111/stable-diffusion-webui) to generate the art with minimal editing and in-painting, which took about an hour and a half. As such, the PNG files contain metadata such as the prompts I used to generate them. I picked two arbitrary artists because I couldn't find any millennium-old Norwegian artists via [this app](https://huggingface.co/spaces/terrariyum/SDXL-artists-browser), but more importantly, I targeted a painting style that served to mask the AI artifacts like strange numbers and lengths of fingers.

The character classes ("species") and abilities are mostly a joke, and they clearly give away why I wanted to make a mobile LAN game. :)