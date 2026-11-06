# Chevarxona · ishbay hisob

Node.js va SQLite asosidagi o‘zbek tilidagi veb-dastur. Admin buyurtma ochadi, ishchilarni ro‘yxatdan o‘tkazadi, operatsiya va tarif yaratadi, ishchilarni operatsiyalarga biriktiradi. Ishchi telefonidan bajargan ishining donasini kiritadi. Admin kunlik va oylik hisobni ko‘radi hamda CSV formatida yuklab oladi.

## GitHub orqali Netlify Free'ga joylashtirish

Netlify ilova va HTTPS manzilini beradi. Ishchilar, yozuvlar va oylik ma’lumotlari Turso Free'dagi doimiy libSQL bazasida saqlanadi. GitHub’dagi kod yangilansa, Netlify ilovani qayta joylashtiradi va o‘sha baza ishlatilaveradi.

1. ZIP ichidagi `chevarxona-netlify` papkasini oching. **Papkaning ichidagi fayllarni** GitHub repozitoriysining asosiy qismiga yuklang. `package.json` va `netlify.toml` repozitoriy boshida turishi kerak. Maxfiy repozitoriy ishlatish mumkin.
2. Turso Free hisobida yangi **libSQL** baza yarating. Baza manzili va shu baza uchun yozish huquqiga ega tokenni oling. Turso CLI ishlatilsa, quyidagi buyruqlar yordam beradi.

```text
turso db create chevarxona
turso db show chevarxona --url
turso db tokens create chevarxona
```

3. Node.js 24 bilan PowerShell terminalida loyiha papkasini oching va admin parolini yarating.

```powershell
npm.cmd ci
npm.cmd run admin:password
```

Buyruq admin paroli va 64 belgili hash chiqaradi. Parolni xavfsiz joyda saqlang. Netlify sozlamasiga hash qiymati kiritiladi.

4. Netlify’da **Add new project → Import an existing project → GitHub** orqali repozitoriyni tanlang. Build buyruqlari `netlify.toml` ichida tayyor. Netlify’dagi **Project configuration → Environment variables** bo‘limiga quyidagilarni qo‘shing. Scope tanlash imkoniyati bo‘lsa, **Functions**ni belgilang. Qiymatlarni **Production** deploy kontekstiga kiriting.

| Sozlama | Qiymat |
| --- | --- |
| `TURSO_DATABASE_URL` | Turso bergan libSQL manzil |
| `TURSO_AUTH_TOKEN` | Turso bergan yozish huquqiga ega token |
| `ADMIN_PASSWORD_HASH` | `npm run admin:password` chiqargan 64 belgili hash |
| `ADMIN_LOGIN` | Ixtiyoriy, standart ID `boshliq` |
| `WORK_TIME_ZONE` | Ixtiyoriy, standart `Asia/Tashkent` |
| `APP_ORIGIN` | Ixtiyoriy, standart qiymat Netlify bergan asosiy HTTPS manzil |

5. Sozlamalar qo‘shilgach, **Deploys** bo‘limida yangi deploy boshlang. Netlify bergan `*.netlify.app` HTTPS manzilini oching. Ilova jadval va birinchi adminni avtomatik yaratadi. **Admin kirishi** orqali admin ID va 3-qadamdagi parol bilan kiring.

Baza tokeni, hash va admin parolini GitHub’ga yuklamang. Ikki xizmatda ham **Free** tarifini tanlang. Bepul tariflarning limitlari bor. Limit tugasa xizmat vaqtincha to‘xtashi mumkin. Xodimlarni qo‘shishdan oldin yakuniy HTTPS manzilni tanlang, chunki kirish kalitlari shu manzilga bog‘lanadi.

Bu versiya yangi Turso bazasiga ulanadi. Oldingi mahalliy yoki Cloudflare yozuvlari avtomatik ko‘chmaydi.

- Netlify’ga GitHub’dan joylashtirish — https://docs.netlify.com/manage/projects/add-new-project/
- Netlify funksiyalari uchun muhit o‘zgaruvchilari — https://docs.netlify.com/build/functions/environment-variables/
- Netlify Free limitlari — https://docs.netlify.com/manage/accounts-and-billing/billing-for-credit-based-plans/credit-based-pricing-plans/
- Turso Free limitlari — https://turso.tech/pricing

## Windowsda mahalliy ishga tushirish

Node.js 24 yoki yangiroq versiyasini o‘rnating. ZIP faylni oching va PowerShell terminalida arxivdan chiqqan chevarxona papkasiga o‘ting.

```powershell
npm.cmd ci
$env:ADMIN_PASSWORD = Read-Host 'Admin uchun yangi parol (kamida 12 belgi)' -MaskInput
npm.cmd run setup -- boshliq "Chevarxona boshlig‘i"
Remove-Item Env:ADMIN_PASSWORD
npm.cmd start
```

`-MaskInput` uchun PowerShell 7 kerak. Parol 12–128 belgi bo‘lishi kerak. Admin yaratish buyrug‘i bo‘sh bazada bir marta bajariladi.

Brauzerda http://localhost:3000 manzilini oching. **Admin kirishi**ni tanlang va `boshliq` IDsi hamda o‘zingiz yaratgan parol bilan kiring.

## Birinchi buyurtmani ochish

1. **Ishchilar** bo‘limida ism va ID kiriting, masalan `Muqaddam1987`. Chiqqan bir martalik kodni ishchining o‘ziga yuboring. Kod 24 soat amal qiladi.
2. **Buyurtmalar** bo‘limida buyurtma oching, masalan `Oq ko‘ylak`, 100 dona.
3. Buyurtma ichida operatsiya yarating, masalan `Yoqa tikish`, 450 so‘m. Ishchini shu operatsiyaga biriktiring.
4. Ishchi kirish sahifasida o‘z IDsi va kodini kiritib, telefonning kirish kalitini sozlaydi. Keyingi kirishda ID va qurilma tasdig‘i ishlatiladi.
5. Telefon yo‘qolsa yoki almashsa, ishchi qatorida **Yangi kod**ni bosing. Eski kalit va faol seanslar bekor qilinadi.

## Buyurtmani yopish

Admin Jarayonda bo‘limida Yopish tugmasini bosadi va buyurtmani Tugatildi deb belgilaydi. Ishchilarda yangi yozuv va tahrir yopiladi, avvalgi yozuvlar hisobotda qoladi.

## Ish vaqti va hisoblash

- Standart vaqt mintaqasi `Asia/Tashkent`. Korxona boshqa mintaqada bo‘lsa, serverni ishga tushirishdan oldin `WORK_TIME_ZONE` ni o‘rnating.
- Dushanba–shanba 06:00 dan 18:00 gacha joriy kunga yozuv qo‘shish va tahrirlash mumkin. 18:00 dan boshlab yangi yozuv kiritish yopiladi. 20:00 gacha saqlangan yozuvni tuzatish mumkin.
- 20:00 dan boshlab ishchiga yozuv faqat ko‘rish uchun ochiq. Yakshanba kuni ishchiga kiritish yopiq. Keyingi ish kuni 06:00 da yangi sana ochiladi.
- Bir ishchi, bir operatsiya va bir sana uchun bitta yozuv bor. Smena davomida dona ortsa, mavjud yozuvni tahrirlab, kunlik jami donani kiriting. Har bir tahrir uchun sabab yoziladi. Admin eski va yangi qiymatlarni, sababni, vaqtni va kim o‘zgartirganini ko‘radi.
- Yozuvga o‘sha vaqtdagi donabay tarif biriktiriladi. Keyingi tarif o‘zgarishi avvalgi yozuv summasiga ta’sir qilmaydi. Hisobot oxirgi saqlangan donadan hisoblanadi.
- Hisobotdan oy va ishchini tanlash mumkin. CSV faylni Excel orqali UTF-8 va vergul ajratgich bilan import qiling.

## Ishchilarning telefonidan foydalanish

`localhost` shu kompyuterdagi sinov uchun. Xodimlarning telefonlari uchun hamma kira oladigan HTTPS domen kerak. HTTPS xizmatini server oldidagi reverse proxy ta’minlaydi. Node jarayonini bitta nusxada ishga tushiring va SQLite ma’lumotini doimiy diskda saqlang.

| Sozlama | Standart qiymat | Vazifasi |
| --- | --- | --- |
| `APP_ORIGIN` | `http://localhost:3000` | Brauzerda ochiladigan to‘liq manzil, masalan `https://hisob.example.com` |
| `HOST` | `127.0.0.1` | Node tinglaydigan tarmoq manzili |
| `PORT` | `3000` | Node tinglaydigan port |
| `WORK_TIME_ZONE` | `Asia/Tashkent` | Korxona ish vaqti |
| `DB_FILE` | `data/chevarxona.sqlite` | SQLite fayli manzili |

Faollashtirishdan oldin haqiqiy HTTPS domenini tanlang. Kirish kalitlari domen bilan bog‘langan. Reverse proxy HTTPS so‘rovlarini Node portiga yo‘naltirsin. Doimiy zaxira uchun serverni to‘xtatib, `data` papkasini yoki sozlangan SQLite fayli va uning yon fayllarini nusxalang. Serverni qayta ishga tushirganda davomiy ma’lumot uchun shu diskni ulang.

Telefon tasdig‘ini qurilma bajaradi. iPhone Face ID yoki Touch ID ishlatishi mumkin. Qurilma va brauzerga qarab PIN ham ishlatiladi. Server yuz suratini saqlamaydi. Har yangi kirishda tasdiq so‘raladi. Kirgan seans shu brauzerda 30 kungacha amal qiladi yoki **Chiqish** bosilganda tugaydi.

## Sinov

```powershell
npm.cmd test
```

Sinovlar vaqt chegaralari, yakshanba, ishchi huquqlari, takroriy yozuv, tahrir sababi, tarix, tarif, admin kirishi, CSV va WebAuthn ro‘yxatdan o‘tish hamda imzoli kirishni tekshiradi. WebAuthn integratsiya sinovida dasturiy autentifikator ishlatiladi.


Netlify Function ham mahalliy libSQL bilan HTTPS so‘rovlari, imzoli passkey va hisobot bo‘yicha sinovdan o‘tkaziladi. Bu sinov jonli Netlify yoki Turso hisobidan foydalanmaydi.



## Kundalik nazorat va oy yakuni

- Ishchi **Bugungi vazifalarim** bo‘limida faol vazifalariga dona kiritadi. Kiritish paytida taxminiy haq, saqlagach esa yozuvning haqiqiy summasi ko‘rinadi.
- Ishchi 06:00–18:00 da **Bugun ish bo‘lmadi** belgisini qo‘yishi mumkin. Keyin o‘sha kuni dona saqlansa, belgi avtomatik olib tashlanadi.
- Admin **Ishchilar** ro‘yxatida brigada nomini belgilaydi. **Bugun kim kiritmadi?** bo‘limi ochiq buyurtmaga biriktirilgan ishchilarni kuzatadi va brigada hamda buyurtma bo‘yicha filtrlaydi.
- **Jarayonda** bo‘limidagi chiziq operatsiyaning bajarilgan donasini rejaga solishtiradi.
- **Oylik hisobot**da admin tugagan oyni yopishi mumkin. Tuzatish uchun oy sabab bilan qayta ochiladi. Yopish va qayta ochish tarixi saqlanadi. Tuzatish tugagach, oyni yana yoping.
- GitHub orqali yangilashda app.mjs, model.mjs, view.mjs, work.js va style.css fayllarini birga almashtiring. Yangi jadvallar mavjud Turso bazasida avtomatik ochiladi.

## Ishchilarni brigada va ish turi bo‘yicha tartiblash

**Ishchilar → Ishchi qo‘shish** oynasida ism-familiya va ID bilan birga brigada hamda ish turini kiriting. Ilgari kiritilgan nomlar taklif sifatida ko‘rinadi. Buyurtmadagi aniq operatsiya tanlansa, ishchi shu operatsiyaga biriktiriladi. Ish turi maydoni bo‘sh bo‘lsa, operatsiya nomi ish turi sifatida olinadi. Ish turi buyurtmaga biriktirishdan alohida yuritiladi. Mavjud ishchini **Guruhini o‘zgartirish** orqali boshqa brigada yoki ish turiga o‘tkazish mumkin.

Netlify’da shu o‘zgarishni joriy qilish uchun GitHub’dagi app.mjs, model.mjs va view.mjs fayllarini birga almashtiring.
