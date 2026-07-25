# فتح التطبيقات جوه المساحة

_Letting a sibling dashboard render inside the workspace._

المساحة بتحاول تفتح كل تطبيق خارجي جوه إطار (`iframe`) تحت نفس الشريط العلوي،
عشان التنقّل بين التطبيقات ما يحسّش إنك خرجت من المنتج.

بس **التطبيق نفسه هو اللي بيقرر** لو ده مسموح. أي موقع يقدر يمنع إنه يتعرض جوه
موقع تاني، وساعتها الإطار بيطلع أبيض فاضي من غير أي رسالة.

---

## إزاي المساحة بتتعامل مع ده

قبل ما تفتح الإطار، السيرفر بيعمل طلب للتطبيق وبيبص على ترويستين:

| الترويسة | النتيجة |
| --- | --- |
| `X-Frame-Options: DENY` | ممنوع — المساحة بتعرض زرار «افتح في تبويب» |
| `X-Frame-Options: SAMEORIGIN` | ممنوع |
| `Content-Security-Policy: frame-ancestors 'none'` | ممنوع |
| `frame-ancestors https://workspace.engosoft.com` | مسموح للمساحة بس |
| مفيش أي منهم | مسموح |

النتيجة بتتخزّن ١٠ دقايق، وبتتلغي أول ما اللينك يتغيّر من الإعدادات.

فيه كمان مهلة ٦ ثواني في الواجهة: لو الإطار ما حمّلش في المدة دي، بيظهر زرار
«افتحه في تبويب» — لأن المتصفح ما بيقولش للصفحة الأم إن الإطار اتمنع.

---

## عشان تخلي تطبيق يقبل الفتح جوه المساحة

الأفضل إنك **تسمح للمساحة بس**، مش لأي موقع.

### Express (SLA · HR)

```js
const HUB = 'https://workspace.engosoft.com';

app.use((req, res, next) => {
  // X-Frame-Options ما بيعرفش يحدد أكتر من أصل واحد — CSP هي الطريقة الصح،
  // فلازم القديمة دي تتشال خالص وإلا هتفضل هي اللي شغّالة في متصفحات كتير.
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', `frame-ancestors 'self' ${HUB}`);
  next();
});
```

### Next.js (تحليلات خدمة العملاء)

في `next.config.mjs`:

```js
const HUB = 'https://workspace.engosoft.com';

export default {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: `frame-ancestors 'self' ${HUB}` },
        ],
      },
    ];
  },
};
```

ولو فيه `X-Frame-Options` متحطوط في `next.config` أو في middleware — شيله.

### Nginx / Caddy قدام التطبيق

```nginx
add_header Content-Security-Policy "frame-ancestors 'self' https://workspace.engosoft.com" always;
proxy_hide_header X-Frame-Options;
```

---

## الكوكيز جوه الإطار

دي أكتر حاجة بتوقّع الناس: التطبيق بيفتح جوه المساحة، بس بيطلب لوجين تاني.

السبب إن الكوكي بتاعه `SameSite=Lax`، والمتصفح ما بيبعتش الكوكي ده في سياق
طرف ثالث (الإطار). الحل إن الكوكي يبقى:

```
Set-Cookie: session=…; HttpOnly; Secure; SameSite=None
```

`SameSite=None` بيفتح باب CSRF، فلازم يتعوّض — تحقق من ترويسة `Origin` على أي
طلب بيغيّر بيانات، أو توكن CSRF في هيدر.

لو ده كتير على تطبيق معيّن، خلي طريقة فتحه **«تبويب جديد»** من إعدادات
المساحة ← التطبيقات. التطبيق هيفضل في الشبكة وفي شريط التطبيقات زي أي حد،
بس هيفتح لوحده.

---

## الوضع دلوقتي

التطبيقات الأربعة **ما تمّش تعديلها** — المساحة بتفتحها زي ما هي. اللي بيحصل
دلوقتي: المساحة بتجرّب الإطار، ولو التطبيق رافض بتوريلك رسالة واضحة وزرار
يفتحه في تبويب. تشتغل من غير أي تعديل عندهم؛ والتعديلات فوق بتحسّن التجربة بس.
