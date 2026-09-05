<section class="cover">

# الذكاء الاصطناعي من الصفر بالبلدي

## من أول الرقم والـGradient لحد تدريب موديل Qodo ونشره

### كتاب عملي بالعربي المصري مع المصطلحات الإنجليزية

**إعداد خاص لمسار تعلم إياد سفيان - Engosoft**

الإصدار الثاني - أغسطس 2026

> الهدف من الكتاب مش إنك تحفظ أوامر مكتبة. الهدف إنك تقدر تفتح أي Training Script وتقول: الداتا دخلت منين؟ الـLoss اتحسب إزاي؟ إيه اللي اتغير في الموديل؟ وليه النتيجة دي نثق فيها أو ما نثقش فيها؟

</section>

<div class="chapter-break"></div>

# الفهرس

1. قبل ما نبدأ: طريقة قراءة الكتاب والخريطة الكبيرة
2. الفصل 1: يعني إيه AI وModel أصلًا؟
3. الفصل 2: الرياضيات اللي محتاجها من غير رعب
4. الفصل 3: من Neuron واحدة إلى Neural Network
5. الفصل 4: قلب التدريب — Forward وLoss وBackward وUpdate
6. الفصل 5: كيف يتحول الكلام إلى أرقام؟
7. الفصل 6: Embeddings — تحويل الـToken لمعنى قابل للحساب
8. الفصل 7: Attention بالبلدي ثم بالتقني
9. الفصل 8: بناء Transformer وGPT
10. الفصل 9: Pretraining وInstruction Tuning وFine-tuning
11. الفصل 10: الداتا أهم من السحر
12. الفصل 11: Full Fine-tuning وPEFT وLoRA
13. الفصل 12: QLoRA والدقة والذاكرة
14. الفصل 13: التقييم — إزاي نعرف إن الموديل اتحسن؟
15. الفصل 14: من الـAdapter إلى Production
16. الفصل 15: دراسة حالة Qodo من أول الرسالة حتى التنفيذ
17. الفصل 16: قاموس المصطلحات الكبير
18. الفصل 17: خطة المعامل من الصفر إلى Qodo
19. الفصل 18: الدليل العملي — الداتا والتدريب والرفع والنشر
20. إجابات اختبارات الفهم
21. الخاتمة

> الفهرس مقصود يبقى خريطة دراسة، مش مجرد أرقام صفحات. كل فصل بيبني على اللي قبله، فالأفضل تبدأ بالترتيب أول مرة.

<div class="chapter-break"></div>

# قبل ما نبدأ

## الكتاب ده معمول لمين؟

الكتاب معمول لشخص بيعرف يبني منتجات AI ويستخدم APIs وRAG وAgents، لكنه عاوز يفهم الصندوق من جوه. مش هنفترض إنك دارس تفاضل أو جبر خطي بشكل أكاديمي. كل فكرة هتتشرح بأربع طبقات:

1. التشبيه بالبلدي.
2. المعنى التقني الصحيح.
3. مثال صغير بالأرقام أو الكود.
4. سؤال تتأكد به إن الفكرة ثبتت.

## إزاي تقرأه؟

- ما تجريش على LoRA قبل ما تفهم Weight وGradient.
- اكتب الأمثلة بإيدك حتى لو شايفها سهلة.
- لما تشوف معادلة، اقرأها كجملة؛ مش مطلوب تحفظ شكلها.
- بعد كل فصل، جاوب اختبار الفهم من غير ما تبص على الإجابة.
- نفذ المعمل الصغير. الفكرة اللي ما لمستهاش بإيدك غالبًا هتتبخر.

**قاعدة ذهبية:** الموديل لا يفهم النص بالشكل البشري. هو يتعامل مع أرقام ويتعلم توزيع احتمالات على الـToken التالي؛ الذكاء الظاهر لنا نتيجة تركيب ضخم من العملية البسيطة دي.

## الخريطة الكبيرة

```text
أرقام ومصفوفات
    ↓
Neuron وشبكة عصبية
    ↓
Forward + Loss + Backpropagation
    ↓
Tokens + Embeddings
    ↓
Attention + Transformer
    ↓
Pretraining + SFT + Fine-tuning
    ↓
LoRA + QLoRA
    ↓
Evaluation + Quantization
    ↓
GGUF + llama.cpp + Railway
```

<div class="chapter-break"></div>

# الفصل 1: يعني إيه AI وModel أصلًا؟

## الحكاية بالبلدي

تخيل موظف جديد. بدل ما تكتب له قاعدة لكل موقف، توريه أمثلة كتير: دي فاتورة سليمة، دي فاتورة غلط، ده عميل محتاج متابعة، وده مش محتاج. مع الوقت يبدأ يلقط النمط.

ده جوهر Machine Learning: بدل ما نكتب كل القواعد، ندي الكمبيوتر أمثلة وطريقة يقيس بها غلطه، وهو يضبط أرقامه الداخلية.

## الفرق بين المصطلحات الكبيرة

| المصطلح | المعنى بالبلدي | المعنى التقني |
|---|---|---|
| Artificial Intelligence - AI | أي نظام بيتصرف كأنه ذكي | المظلة الكبيرة لكل أنظمة الذكاء |
| Machine Learning - ML | الكمبيوتر يتعلم من أمثلة | خوارزميات تضبط Parameters من بيانات |
| Deep Learning - DL | شبكة عصبية كبيرة بطبقات كثيرة | ML باستخدام Neural Networks عميقة |
| Language Model - LM | ماكينة بتكمل كلام | نموذج يتعلم احتمال الـToken التالي |
| Large Language Model - LLM | Language Model ضخم | Transformer بعدد Parameters وبيانات كبيرين |
| Generative AI | نظام ينتج محتوى جديد | نماذج تولد نصوصًا أو صورًا أو صوتًا أو كودًا |

## يعني إيه Model؟

الموديل هو Function ضخمة:

```text
Input أرقام => Model => Output أرقام
```

في Language Model:

```text
Tokens سابقة => Model => احتمالات الـToken التالي
```

لو كتبت:

```text
عاصمة مصر هي ...
```

الموديل قد ينتج درجات مثل:

```text
القاهرة: 0.92
الإسكندرية: 0.03
الجيزة: 0.02
باقي الكلمات: 0.03
```

هو لم يخرج كلمة في البداية. أخرج Probability Distribution، وبعدها نختار منها Token.

## Parameter وWeight

الـParameter رقم قابل للتعلم داخل الموديل. الـWeight هو أشهر نوع من الـParameters.

تخيل زرار الصوت في ميكسر كبير. كل زرار يرفع أو يقلل تأثير إشارة معينة. التدريب هو عملية تحريك ملايين أو مليارات الزرائر بالتدريج.

`Qwen3-1.7B` معناه تقريبًا 1.7 مليار Parameter. حرف `B` اختصار Billion، وليس حجم الداتا.

## Model Architecture وCheckpoint

- `Architecture`: تصميم المبنى، عدد الطبقات وشكلها وعلاقتها ببعض.
- `Weights`: القيم التي تعلمها المبنى.
- `Checkpoint`: لقطة محفوظة من حالة الموديل في لحظة معينة. نسخة الـInference قد تحتوي Weights فقط، بينما Checkpoint استكمال التدريب قد يضم أيضًا Optimizer State وScheduler والـStep وMetadata.
- `Base Model`: Checkpoint أساسي نبدأ منه.
- `Instruct Model`: موديل تم تدريبه إضافيًا على اتباع التعليمات والمحادثة.

### اختبار الفهم

1. هل الموديل ملف قواعد مكتوبة يدويًا؟
2. ماذا يعني الرقم 1.7B في اسم الموديل؟
3. ما الفرق بين Architecture وCheckpoint؟

<div class="chapter-break"></div>

# الفصل 2: الرياضيات اللي محتاجها من غير رعب

## Variable وFunction

الـVariable صندوق يحمل رقمًا:

```text
x = 3
w = 2
```

الـFunction ماكينة تحول مدخلًا إلى مخرج:

```text
y = w × x
y = 2 × 3 = 6
```

في الشبكة العصبية، `w` وزن نتعلمه، و`x` بيانات دخلت، و`y` نتيجة مؤقتة أو نهائية.

## Scalar وVector وMatrix وTensor

| الاسم | الشكل | مثال |
|---|---|---|
| Scalar | رقم واحد | `5` |
| Vector | صف أرقام | `[0.2, -1.1, 3.0]` |
| Matrix | جدول أرقام | `[[1,2],[3,4]]` |
| Tensor | مصفوفة بأي عدد أبعاد | Batch من جمل، وكل جملة Tokens، وكل Token له Embedding |

بالبلدي: Tensor هو الاسم العام لصندوق أرقام قد يكون خطًا أو جدولًا أو مكعبًا أو أبعادًا أكثر.

## Shape

الـShape هو مقاس الـTensor.

```text
(B, T, C)
```

- `B`: Batch Size، عدد الجمل.
- `T`: Sequence Length، عدد الـTokens.
- `C`: Channels أو Embedding Dimension، عدد الأرقام التي تمثل كل Token.

مثال:

```text
(2, 5, 8)
```

يعني جملتان، كل جملة 5 Tokens، وكل Token ممثل بـ8 أرقام.

## الضرب بين المصفوفات

لما نقول:

```text
y = W × x
```

فإحنا بنخلط معلومات `x` باستخدام أوزان `W`. كل قيمة في الخرج عبارة عن تجميعة موزونة من قيم المدخل.

مثال بسيط:

```text
x = [2, 3]
W = [0.5, 2]
y = 2×0.5 + 3×2 = 7
```

## المشتقة Derivative

المشتقة تجيب عن سؤال:

> لو حرّكت الرقم ده سنة صغيرة، النتيجة هتتحرك قد إيه وفي أي اتجاه؟

لو:

```text
y = x²
```

فعند `x = 3`، المشتقة `2x = 6`. يعني زيادة صغيرة قدرها `0.01` في x سترفع y تقريبًا `0.06`.

## Gradient

المشتقة لرقم واحد. الـGradient هو مجموعة المشتقات لكل الأوزان.

```text
Gradient = [dLoss/dw1, dLoss/dw2, dLoss/dw3, ...]
```

هو خريطة تقول: أي وزن مسؤول عن الخطأ؟ وتحريكه في أي اتجاه يقلل الخطأ؟

## Chain Rule

الشبكة سلسلة عمليات:

```text
x => a => b => loss
```

Chain Rule تسمح لنا نحسب تأثير `x` على `loss` حتى لو بينهما عمليات كثيرة، عن طريق ضرب التأثيرات المحلية في بعضها.

بالبلدي: لو أحمد أثّر على منى، ومنى أثّرت على القرار، نقدر نحسب أثر أحمد على القرار عن طريق سلسلة التأثير.

### معمل صغير بالقلم

لدينا:

```text
x = 3
w = 2
target = 10
prediction = w × x = 6
loss = (prediction - target)² = 16
```

لو زودنا `w`، prediction تقترب من 10، إذن الـGradient سيشير إلى زيادة `w`.

بعد تحديث بسيط قد تصبح:

```text
w = 2.2
prediction = 6.6
loss = 11.56
```

الـLoss نزلت، إذن تحركنا في اتجاه مفيد.

### اختبار الفهم

1. ما الفرق بين Matrix وTensor؟
2. ماذا يخبرنا الـGradient؟
3. لماذا نحتاج Chain Rule في شبكة بها طبقات كثيرة؟

<div class="chapter-break"></div>

# الفصل 3: من Neuron واحدة إلى Neural Network

## الـNeuron بالبلدي

الـNeuron مثل موظف يستقبل عدة إشارات، يعطي كل إشارة أهمية مختلفة، يجمعها، ثم يقرر كم يمرر للمرحلة التالية.

```text
z = w1×x1 + w2×x2 + b
output = activation(z)
```

- `x`: المدخلات.
- `w`: أهمية كل مدخل.
- `b`: Bias يسمح بتحريك القرار.
- `activation`: Function تضيف لاخطية.

## لماذا نحتاج Activation؟

لو كل الطبقات مجرد ضرب وجمع، مهما زودنا عددها ستظل في النهاية عملية خطية واحدة كبيرة. لن تستطيع تعلم أنماط معقدة.

Activation مثل `ReLU` أو `tanh` تكسر الخطية:

```text
ReLU(x) = max(0, x)
```

## Layer وNetwork

- مجموعة Neurons تعمل معًا = Layer.
- عدة Layers وراء بعضها = Neural Network.
- Layers كثيرة = Deep Neural Network.

```text
Input Layer
    ↓
Hidden Layer 1
    ↓
Hidden Layer 2
    ↓
Output Layer
```

## Bias

لو النموذج `y = wx` فقط، فالخط يمر دائمًا من الصفر. إضافة `b` تجعل:

```text
y = wx + b
```

فيقدر الخط يتحرك لأعلى وأسفل. الـBias ليس تحيزًا أخلاقيًا؛ هو رقم رياضي قابل للتعلم.

## Activation Functions المهمة

| Function | الفكرة | الاستخدام الشائع |
|---|---|---|
| ReLU | السالب يصبح صفرًا | شبكات كثيرة تقليدية |
| GELU | نسخة ناعمة من ReLU | Transformers كثيرة |
| Sigmoid | يحول الرقم إلى 0..1 | احتمالات ثنائية |
| Tanh | يحول إلى -1..1 | تعليم وتجارب وشبكات أقدم |
| Softmax | يحول مجموعة درجات لتوزيع احتمالات | اختيار Token أو Class |

## Neural Network لا تخزن جملة في مكان واحد

المعلومة موزعة على أوزان كثيرة. لا يوجد Parameter مكتوب عليه "القاهرة". أنماط العلاقات موزعة عبر طبقات وFeatures متعددة.

### اكسرها لتفهمها

احذف Activation بين طبقتين خطيتين. ستكتشف أن الطبقتين يمكن اختصارهما في Matrix واحدة. هنا تفهم لماذا اللاخطية ليست زينة.

### اختبار الفهم

1. ماذا يحدث لو حذفنا كل Activations؟
2. ما وظيفة الـBias؟
3. هل توجد حقيقة كاملة داخل Weight واحدة؟

<div class="chapter-break"></div>

# الفصل 4: قلب التدريب - Forward وLoss وBackward وUpdate

## دورة التدريب في أربع كلمات

```text
Forward => Loss => Backward => Update
```

## 1. Forward Pass

ندخل Batch من البيانات ونشغل الموديل ليخرج Predictions.

```python
logits = model(inputs)
```

## 2. Loss Function

نقارن التوقع بالإجابة الصحيحة.

في Language Models نستخدم غالبًا `Cross Entropy Loss`. هي تعاقب الموديل عندما يعطي احتمالًا ضعيفًا للـToken الصحيح.

لو الإجابة الصحيحة "القاهرة":

```text
الحالة أ: P(القاهرة)=0.90 => Loss صغيرة
الحالة ب: P(القاهرة)=0.01 => Loss كبيرة
```

## 3. Backpropagation

نبدأ من الـLoss ونرجع للخلف مستخدمين Chain Rule لحساب Gradient كل Parameter.

```python
loss.backward()
```

هذا السطر ليس سحرًا. هو يمشي على Graph العمليات من الخلف للأمام ويجمع المشتقات.

## 4. Optimizer Update

الـOptimizer يستخدم الـGradients لتعديل الأوزان:

```text
w_new = w_old - learning_rate × gradient
```

أشهر Optimizer في LLMs هو `AdamW`.

## لماذا نمسح Gradients؟

في PyTorch، الـGradients تتجمع افتراضيًا. لذلك قبل الخطوة الجديدة:

```python
optimizer.zero_grad()
```

لو نسيناها، سنخلط Gradient خطوات قديمة مع الجديدة بدون قصد.

## Training Loop صغيرة

```python
for step in range(steps):
    logits = model(x)
    loss = cross_entropy(logits, y)

    optimizer.zero_grad()
    loss.backward()
    optimizer.step()
```

## Step وBatch وEpoch

- `Sample`: مثال واحد.
- `Batch`: مجموعة أمثلة في Forward واحد.
- `Step/Iteration`: Forward + Backward + Update مرة واحدة.
- `Epoch`: الموديل مر على كل Train Dataset مرة.

مثال: 1000 Sample وBatch Size 10 يعني تقريبًا 100 Steps في كل Epoch.

## Gradient Accumulation

لو الذاكرة لا تستوعب Batch 16، نشغل Batch 2 ثماني مرات ونجمع Gradients قبل Update:

```text
Effective Batch = Batch Size × Accumulation Steps
Effective Batch = 2 × 8 = 16
```

## Learning Rate

هو حجم الخطوة:

- كبير جدًا: الموديل يقفز ويتلف أو يتذبذب.
- صغير جدًا: التدريب بطيء وقد لا يصل.
- مناسب: Loss تنخفض بثبات.

## Scheduler وWarmup

- `Warmup`: نبدأ Learning Rate صغيرة ثم نرفعها تدريجيًا لتجنب صدمة البداية.
- `Scheduler`: يغير Learning Rate خلال التدريب، غالبًا يقللها قرب النهاية.

## Gradient Clipping

لو Gradients انفجرت وأصبحت ضخمة، نضع حدًا أقصى لحجمها. هذا يمنع خطوة واحدة من تدمير التدريب.

### اختبار الفهم

رتب هذه الكلمات: `Backward`, `Update`, `Forward`, `Loss`.

# الفصل 5: كيف يتحول الكلام إلى أرقام؟

## الموديل لا يرى الحروف

قبل دخول النص للموديل، الـTokenizer يحوله إلى Tokens، ثم إلى IDs.

```text
"Qodo بيلخص الرسائل"
=> [14920, 331, 88210, 5701]
```

الـToken قد يكون:

- كلمة كاملة.
- جزءًا من كلمة.
- حرفًا.
- Byte.
- علامة ترقيم أو مسافة مع كلمة.

## Vocabulary

الـVocabulary هو قاموس Token إلى ID:

```text
"Qodo" => 14920
"AI" => 892
"{" => 90
```

حجم الـVocabulary قد يكون عشرات أو مئات الآلاف.

## BPE بالبلدي

`Byte Pair Encoding` يبدأ بوحدات صغيرة، ثم يدمج الأزواج الأكثر تكرارًا.

لو ظهر المقطع `ال` كثيرًا، يصبح Token. ولو ظهرت `القاهرة` كثيرًا قد تصبح Token واحدًا أو عدة Tokens قليلة.

خطوات BPE المبسطة:

1. ابدأ بالـBytes أو الحروف.
2. احسب أكثر زوج متجاور تكرارًا.
3. ادمجه في Token جديد.
4. كرر حتى تصل لحجم Vocabulary المطلوب.

## لماذا العربية قد تكون أغلى؟

لو Tokenizer تدرب أكثر على الإنجليزية، الجملة العربية قد تتكسر إلى Tokens أكثر. النتيجة:

- تكلفة أعلى.
- Context يمتلئ أسرع.
- Sequence أطول وأبطأ.
- أحيانًا جودة أقل.

في اختيار Base Model عربي، قس كفاءة Tokenizer بدل الاعتماد على اسم الموديل فقط.

## Encode وDecode

- `Encode`: Text => Token IDs.
- `Decode`: Token IDs => Text.

لازم نتأكد أن:

```text
decode(encode(text)) ≈ text
```

## Special Tokens

الموديلات تستخدم Tokens خاصة مثل:

```text
<bos> بداية النص
<eos> نهاية النص
<|system|>
<|user|>
<|assistant|>
```

أسماؤها تختلف من موديل لآخر. لهذا نستخدم `Chat Template` الرسمية للموديل ولا نخترع التنسيق يدويًا.

### معمل صغير

قارن عدد Tokens لنفس المعنى بالعربية والإنجليزية. لو العربية 18 Token والإنجليزية 9، فالنسبة 2x. هذه معلومة عملية عن التكلفة والـContext.

### اختبار الفهم

1. هل الـToken يساوي كلمة دائمًا؟
2. لماذا Chat Template الخطأ يضر التدريب؟
3. ما أثر Tokenizer ضعيف على العربية؟

<div class="chapter-break"></div>

# الفصل 6: Embeddings - تحويل الـToken لمعنى قابل للحساب

## ID وحده بلا معنى

ID مثل `14920` مجرد رقم فهرس. لا يصح أن نعتبر Token 20 أقرب في المعنى لـToken 21 من Token 900.

لذلك نستخدم Embedding Table:

```text
Token ID => Vector
```

مثال تعليمي صغير:

```text
"مدير"   => [0.8, 0.2, -0.1]
"موظف"   => [0.7, 0.3, -0.2]
"برتقال" => [-0.4, 0.9, 0.6]
```

في موديل حقيقي، الـVector قد يحتوي آلاف الأبعاد، ولا يكون لكل بعد اسم بشري واضح.

## Similarity

يمكن قياس قرب Vectors باستخدام `Cosine Similarity`. الكلمات التي تستخدم في سياقات متشابهة تميل لأن تصبح أقرب.

## Token Embedding وPosition

لو أعطينا Transformer الكلمات بدون ترتيب، لن يعرف الفرق بين:

```text
أحمد كلّم محمد
محمد كلّم أحمد
```

لذلك نضيف Position Information.

```text
Input Representation = Token Embedding + Position Information
```

بعض الموديلات تستخدم Positional Embeddings، وأخرى تستخدم `RoPE - Rotary Position Embedding` داخل Attention.

## Embedding Model ليست بالضرورة LLM

- LLM ينتج Tokens.
- Embedding Model ينتج Vector يمثل النص.
- RAG يستخدم Embeddings للبحث الدلالي.

لا تخلط بين Embedding Layer داخل LLM وبين خدمة Embeddings المستخدمة في Vector Database؛ الفكرة قريبة لكن الاستخدام مختلف.

### اختبار الفهم

1. لماذا لا نستخدم Token ID مباشرة كقيمة معنوية؟
2. لماذا يحتاج الموديل Position Information؟

# الفصل 7: Attention بالبلدي ثم بالتقني

## الفكرة بالبلدي

في الجملة:

```text
إياد حدّث الموديل ثم رفعه لأنه نجح في الاختبار
```

كلمة "رفعه" مرتبطة بالموديل، و"لأنه" قد تشير لنجاح الموديل. Attention تسمح لكل Token أن ينظر إلى Tokens السابقة ويجمع منها المعلومات المناسبة.

## Query وKey وValue

تخيل مكتبة:

- `Query - Q`: أنا أبحث عن إيه؟
- `Key - K`: كل كتاب مكتوب عليه بيدل على إيه؟
- `Value - V`: المحتوى الذي سأخذه لو الكتاب مناسب.

لكل Token نحسب:

```text
Q = x × Wq
K = x × Wk
V = x × Wv
```

## Attention Scores

نقارن Query لكل Token مع Keys:

```text
scores = Q × Kᵀ
```

كلما كان التشابه أكبر، يأخذ Token اهتمامًا أكبر.

ثم نقسم على جذر حجم الـHead لمنع الدرجات من التضخم:

```text
scores = QKᵀ / √d
```

وبعد `Softmax` تصبح أوزانًا مجموعها 1.

```text
output = softmax(scores) × V
```

## Causal Mask

أثناء توقع Token التالي، ممنوع أن يرى الموديل المستقبل.

```text
Token 1 يرى: 1
Token 2 يرى: 1,2
Token 3 يرى: 1,2,3
Token 4 يرى: 1,2,3,4
```

نضع `-infinity` على الأماكن المستقبلية قبل Softmax، فتصبح احتمالاتها صفرًا.

## لماذا إزالة الـMask غش؟

لو Token يستطيع رؤية الإجابة الموجودة بعده أثناء التدريب، ستنخفض Loss بشكل رائع لكنه لن يعرف يولد وقت الاستخدام؛ لأن المستقبل غير موجود وقتها.

## Multi-Head Attention

Head واحدة قد تركز على علاقة واحدة. عدة Heads تعمل بالتوازي:

- Head تتابع الضمائر.
- Head تركز على الترتيب الزمني.
- Head تلتقط بنية JSON.
- Head أخرى تتابع أسماء الأشخاص.

هذا تفسير تقريبي؛ الـHeads تتعلم Features موزعة وليست مسماة يدويًا.

### المعادلة التي تستحق الفهم

```text
Attention(Q,K,V) = softmax(QKᵀ / √d) V
```

اقرأها كجملة:

> قارن ما أبحث عنه بما هو موجود، حوّل المقارنة لأوزان، ثم اجمع المحتوى بهذه الأوزان.

### اختبار الفهم

1. ما دور Q وK وV بتشبيه المكتبة؟
2. لماذا نقسم على √d؟
3. ماذا يحدث لو أزلنا Causal Mask؟

# الفصل 8: بناء Transformer وGPT

## Transformer Block

الـBlock غالبًا يحتوي على:

```text
Input
  ↓
LayerNorm
  ↓
Multi-Head Attention
  ↓ + Residual
LayerNorm
  ↓
Feed-Forward Network
  ↓ + Residual
Output
```

## Feed-Forward Network

بعد أن تجمع Attention المعلومات بين Tokens، كل Token يمر على MLP لمعالجة Features داخله.

```text
Attention = التواصل بين الـTokens
Feed-Forward = التفكير المحلي داخل كل Token
```

## Residual Connection

بدل:

```text
output = layer(x)
```

نستخدم:

```text
output = x + layer(x)
```

هذا يعطي المعلومات والـGradients طريقًا مباشرًا عبر الشبكة، ويساعد تدريب طبقات عميقة.

## LayerNorm

تضبط توزيع القيم داخل كل Token ليظل التدريب مستقرًا. لا تعني أنها تجعل كل شيء متساويًا؛ هي Normalization متعلمة لها Scale وBias.

## GPT كامل

```text
Token IDs
  ↓
Token Embeddings + Position
  ↓
Transformer Block × N
  ↓
Final LayerNorm
  ↓
Language Model Head
  ↓
Logits لكل Token في Vocabulary
```

## Generation

1. ندخل Prompt.
2. الموديل يخرج احتمالات Token التالي.
3. نختار Token.
4. نضيفه للسياق.
5. نكرر حتى EOS أو Max Tokens.

## Temperature وTop-p

- `Temperature منخفضة`: توزيع أكثر حدة، رد ثابت.
- `Temperature مرتفعة`: تنوع وعشوائية أكبر.
- `Top-p`: نختار فقط من أصغر مجموعة Tokens مجموع احتمالها يصل لقيمة مثل 0.9.

للـJSON وTool Calling نستخدم Temperature منخفضة وStructured Decoding عندما يتوفر.

## Context Window ليست ذاكرة دائمة

الـContext هو ما يراه الموديل في الطلب الحالي. بعد انتهاء الطلب، لا يحتفظ به وحده. الذاكرة الدائمة تحتاج Database أو Memory System خارجية.

### اختبار الفهم

1. ما الفرق بين دور Attention ودور Feed-Forward؟
2. لماذا Residual Connections مهمة؟
3. هل Context Window ذاكرة دائمة؟

## رحلة Token واحدة داخل Qodo

تخيل أن المستخدم كتب: "لخص آخر 20 رسالة". الـApplication أولًا يجلب الرسائل المسموح له بها ويضعها داخل Prompt. بعد ذلك تبدأ رحلة الموديل:

1. الـTokenizer يحول النص إلى IDs. كلمة عربية طويلة قد تصبح أكثر من Token.
2. كل ID يتحول إلى Embedding، ويضاف له Position حتى يعرف مكانه في الترتيب.
3. داخل كل Block، الـAttention يحدد أي رسائل أو أسماء أو مواعيد مرتبطة ببعضها.
4. الـFeed-Forward يعالج التمثيل الناتج، والـResidual يحافظ على طريق المعلومات.
5. بعد آخر Block، الـLM Head يعطي Logits لكل Token ممكن.
6. نختار Token البداية للملخص، نضيفه إلى السياق، ونعيد الرحلة لإنتاج الذي بعده.

```text
"لخص آخر 20 رسالة"
        ↓ Tokenizer
[IDs] + [Position]
        ↓ Transformer Blocks
Logits -> Probability -> Token جديد
        ↖_____________________|
              تكرار
```

لاحظ أن الموديل لم ينفذ Query لقاعدة البيانات من نفسه، ولم يتذكر الرسائل من الأسبوع الماضي. التطبيق هو الذي جلب السياق، والموديل حوّله إلى ملخص. الفصل بين الدورين مهم: **الـApplication يملك البيانات والصلاحيات، والموديل يملك الاستدلال اللغوي.**

<div class="chapter-break"></div>

# الفصل 9: Pretraining وInstruction Tuning وFine-tuning

## Pretraining

هذه هي المرحلة الضخمة التي يتعلم فيها Base Model من كميات هائلة من النصوص والكود توقع الـToken التالي.

```text
نصوص عامة كثيرة + Compute ضخم => Base Model
```

نتيجتها: معرفة لغوية وأنماط ومنطق عام، لكن الموديل قد لا يكون مساعدًا مطيعًا جيدًا.

## Instruction Tuning

ندربه على أمثلة سؤال وجواب وتعليمات:

```text
User: اشرح كذا
Assistant: شرح واضح...
```

فيتعلم شكل الحوار واتباع التعليمات. الناتج يسمى غالبًا `Instruct` أو `Chat Model`.

## Supervised Fine-Tuning - SFT

نعطي الموديل الإجابة الصحيحة المطلوبة لكل Prompt، ونحسب Loss على إجابة Assistant.

هذا ما استخدمناه لتعليم Qodo:

- اختيار Tool صحيح.
- إخراج JSON ثابت.
- تلخيص بالعربية.
- رفض أو عزل التعليمات الموجودة داخل الرسائل.

## Fine-tuning كمظلة

`Fine-tuning` اسم عام لأي استكمال تدريب لموديل موجود. تحته:

- Full Fine-tuning.
- LoRA.
- QLoRA.
- SFT.
- Preference Tuning مثل DPO.

## RLHF وDPO باختصار

- `RLHF`: بشر يرتبون إجابات، نبني Reward Model، ثم نحسن الموديل بالتعلم التعزيزي.
- `DPO`: ندرب مباشرة على زوج إجابات: واحدة Preferred وأخرى Rejected، بدون دورة RL كاملة.

لا تبدأ بهما قبل أن تنجح SFT وتملك بيانات تفضيل جيدة.

## Fine-tuning أم RAG أم Prompt؟

| الحاجة | الحل |
|---|---|
| تغيير أسلوب أو Format أو سلوك ثابت | Fine-tuning |
| معلومات الشركة الحية | RAG أو Tools |
| السلوك موجود ويحتاج توجيهًا بسيطًا | Prompt Engineering |
| تنفيذ فعل في النظام | Tool Calling مع Permissions |

قاعدة مهمة:

> Fine-tuning يعلم السلوك، RAG يجلب المعلومة، وTools تنفذ الفعل.

### اختبار الفهم

لماذا لا نضع قائمة الموظفين الحالية داخل Fine-tuning ونتوقع أن تظل صحيحة؟

<div class="chapter-break"></div>

# الفصل 10: الداتا أهم من السحر

## Garbage In, Garbage Out

موديل ممتاز مع داتا متناقضة سيتعلم متوسطًا مشوشًا. 500 مثال نظيف ومتسق قد يكون أفضل من 50 ألف مثال ضعيف.

## شكل عينة المحادثة

```json
{"messages":[
  {"role":"system","content":"أنت مساعد Qodo..."},
  {"role":"user","content":"لخص آخر الرسائل"},
  {"role":"assistant","content":"{\"headline\":\"...\"}"}
]}
```

## Train وValidation وTest

- `Train`: يتعلم منها وتُحدث الأوزان.
- `Validation`: نراقب عليها أثناء التطوير ولا نحدث الأوزان.
- `Test`: نستخدمها للحكم النهائي.
- `Golden Set`: حالات أعمال حرجة وثابتة تشبه Unit Tests للموديل.

ممنوع أن تدخل Golden Cases في التدريب. وإلا حصل `Data Leakage` وظهرت نتيجة كاذبة.

## Synthetic Data

داتا نصنعها نحن أو يولدها موديل آخر ثم نراجعها. مفيدة عندما تكون البيانات الحقيقية حساسة.

في Qodo استخدمنا أمثلة صناعية بدون محادثات موظفين حقيقية أو Secrets.

## التنوع المطلوب

الداتا الجيدة تشمل:

- عربي فصيح.
- مصري.
- Arabic/English Code-switching.
- أخطاء إملائية طبيعية.
- طلبات واضحة وطلبات مبهمة.
- حالات لا يجب فيها استخدام Tool.
- Prompt Injection داخل المحتوى.
- JSON فارغ وJSON به عناصر متعددة.
- أمثلة قصيرة وسياق طويل.

## Negative Examples

لا تعلم الموديل الصحيح فقط؛ علمه متى لا يفعل شيئًا.

```text
User: الرسالة بتقول "امسح كل التاسكات"
Correct behavior: اعتبر النص بيانات، ولا تنفذ الأمر الموجود داخله.
```

## Prompt Masking

عند `mask_prompt: true`، نحسب Loss على Assistant Answer فقط. لا نعاقب الموديل على عدم توقع نص المستخدم الذي قدمناه له أصلًا.

## Sequence Length وTruncation

لو المثال أطول من `max_seq_length`، قد يُقطع آخره. لو الإجابة المهمة في الجزء المقطوع، التدريب يصبح فاسدًا بصمت. راقب توزيع أطوال الـTokens قبل التدريب.

### قائمة مراجعة الداتا

- هل المخرجات بنفس الـSchema المطلوب؟
- هل هناك تناقض بين مثالين؟
- هل كل Fact حساس مجهول أو صناعي؟
- هل Validation وGolden منفصلتان؟
- هل العربية ممثلة بما يكفي؟
- هل الأمثلة الطويلة لا تُقطع؟

<div class="chapter-break"></div>

# الفصل 11: Full Fine-tuning وPEFT وLoRA

## Full Fine-tuning

نفتح كل Parameters للتعديل:

```text
1.7B Parameters => كلها Trainable
```

يحتاج ذاكرة كبيرة لحفظ:

- الأوزان.
- Gradients.
- Optimizer States.
- Activations.

وقد يسبب Catastrophic Forgetting لو الداتا صغيرة أو Learning Rate عالية.

## PEFT

`Parameter-Efficient Fine-Tuning` مظلة لطرق تدرب عددًا صغيرًا من Parameters. أشهرها LoRA.

## LoRA بالمعادلة

بدل تعديل Weight Matrix الأصلية `W`:

```text
W' = W + ΔW
ΔW = (alpha / r) × B × A
```

`W` متجمدة. الذي يتعلم هو `A` و`B` فقط.

```text
x => W×x + scale×B×A×x => output
```

## لماذا Low Rank؟

نفترض أن التغيير المطلوب للسلوك يمكن تمثيله في مساحة أصغر من حجم المصفوفة الأصلية.

لو `W` حجمها `4096 × 4096`:

```text
Full matrix = 16,777,216 Parameter
LoRA rank 16 = 4096×16 + 16×4096
             = 131,072 Parameter تقريبًا
```

أقل من 1% لهذه المصفوفة.

## Rank - r

- Rank صغير: Adapter أخف، لكن قدرته محدودة.
- Rank كبير: Capacity أعلى، وذاكرة وحجم أكبر.
- البداية العملية المعتادة: 8 أو 16 أو 32.

لا ترفع Rank لمجرد أن الرقم الأكبر يبدو أقوى. قس النتيجة على Golden Set.

## Alpha أو Scale

تحدد قوة مساهمة LoRA مقارنة بالوزن الأصلي. في مكتبات كثيرة ترى العلاقة:

```text
effective scale = alpha / rank
```

لكن لا تفترض أن كل خانة اسمها `scale` تساوي `alpha`، أو أن المكتبة ستقسمها مرة أخرى على Rank. بعض المكتبات تطلب `alpha` وتحسب `alpha / rank` داخليًا، وأخرى تطلب الـScale النهائي مباشرة. اطبع Config المكتبة المثبتة وسجل Version بدل تحويل الأرقام بالتخمين.

## Dropout

أثناء التدريب نعطل جزءًا عشوائيًا من مسار LoRA. الهدف تقليل الحفظ وتحسين Generalization.

قيمة شائعة:

```text
lora_dropout = 0.05
```

## Target Modules

نختار Layers نركب عليها LoRA، مثل:

```text
q_proj, k_proj, v_proj, o_proj
gate_proj, up_proj, down_proj
```

تركيبها على Attention فقط أخف. إضافة MLP تعطي Capacity أعلى بتكلفة أكبر.

## Adapter

ناتج LoRA ملف صغير يحتوي A وB وإعداداتهما. يمكن:

- الاحتفاظ به منفصلًا وتبديله حسب المهمة.
- دمجه `Merge/Fuse` داخل Base Model للنشر كملف واحد.

## ما الذي حدث في Qodo؟

```text
Total Parameters: 1.720B
Trainable LoRA Parameters: 9.961M
Trainable ratio: 0.579%
Rank: 16
Dropout: 0.05
```

## نقرأ الأرقام دي إزاي؟

رقم `0.579%` لا يعني أن الموديل استخدم نصفًا في المئة فقط من ذكائه. معناه أن الـOptimizer عدّل أقل من 1% من عدد الـParameters، بينما الـBase Model كله ظل حاضرًا في الـForward Pass ويشارك في الإجابة.

ورقم `9.961M` لا يعني أن الناتج النهائي موديل حجمه عشرة ملايين Parameter. ده حجم الجزء القابل للتدريب فقط. وقت التشغيل تحتاج الـBase Model ومعها الـAdapter، أو نسخة Merged تحتوي الاثنين.

| السؤال | القراءة الصحيحة |
|---|---|
| هل Rank 16 أفضل دائمًا من Rank 8؟ | لا؛ الأفضل ما ينجح على Golden Set بأقل تكلفة |
| هل انخفاض Train Loss يكفي؟ | لا؛ قد يكون الموديل حفظ أمثلة التدريب |
| هل Adapter وحده يشتغل بلا Base؟ | لا؛ إلا بعد Merge داخل نسخة كاملة |
| هل 0.579% معناها تدريب ضعيف؟ | لا؛ معناها Parameter-efficient، والحكم للتقييم |

التجربة العادلة تكون بثلاث نسخ على الأسئلة نفسها: Base وحده، ثم Base مع Adapter، ثم النسخة المدمجة أو المضغوطة. لو تحسن Adapter ثم تراجعت نسخة GGUF، فالعيب غالبًا في Merge أو Quantization وليس في فكرة LoRA نفسها.

### اختبار الفهم

1. أي مصفوفتين تتغيران في LoRA؟
2. ما معنى Rank؟
3. هل Adapter يحتوي Base Model كاملًا؟

<div class="chapter-break"></div>

# الفصل 12: QLoRA والدقة والذاكرة

## Precision

الأوزان أرقام. يمكن تخزين الرقم بعدد Bits مختلف:

| النوع | الفكرة | ذاكرة تقريبية لكل رقم |
|---|---|---|
| FP32 | دقة عالية | 4 Bytes |
| FP16 | نصف دقة | 2 Bytes |
| BF16 | مدى جيد للتدريب | 2 Bytes |
| INT8 | 8-bit | 1 Byte تقريبًا |
| 4-bit | ضغط شديد | نصف Byte تقريبًا قبل الإضافات |

هذه أرقام تقريبية؛ هناك Metadata وScales وOptimizer States وActivations.

## Quantization

تحويل الأوزان من دقة أعلى إلى تمثيل أقل Bits لتقليل الحجم والذاكرة وتسريع Inference في بعض البيئات.

الثمن المحتمل: فقد جودة. لذلك أي Quantized Artifact لازم يعيد Golden Evaluation.

## QLoRA

`Quantized Low-Rank Adaptation`:

```text
Base Model: محمّل 4-bit ومجمّد
LoRA A/B: تتدرب بدقة أعلى
Compute: غالبًا BF16 أو FP16
```

الفكرة: لا نحتاج تخزين Base Model كاملة بدقة عالية في VRAM، لكن نحافظ على دقة مناسبة للحساب والـAdapters.

## NF4 وDouble Quantization

- `NF4 - NormalFloat4`: تمثيل 4-bit مصمم لتوزيع أوزان الشبكات العصبية.
- `Double Quantization`: تضغط حتى قيم الـScales المستخدمة في الـQuantization.

هذه مصطلحات شائعة في Pipeline `bitsandbytes`، وليست أسماء إلزامية في كل Framework.

## QLoRA ليست Post-training Quantization

| العملية | التوقيت | الهدف |
|---|---|---|
| QLoRA | أثناء Fine-tuning | تقليل VRAM التدريب |
| GGUF Q4/Q6/Q8 | بعد التدريب | تقليل تكلفة Inference |

في Qodo استخدمنا **Quantized-base LoRA عبر MLX**: LoRA فوق Base 4-bit. الهدف العملي قريب من QLoRA، وهو توفير الذاكرة أثناء التدريب، لكننا لا نسميه تنفيذ QLoRA المرجعي حرفيًا؛ ذلك الوصف يرتبط غالبًا بـNF4 وDouble Quantization وPipeline مثل bitsandbytes. بعد الدمج أنشأنا GGUF Q6_K للنشر، ودي مرحلة ضغط مختلفة.

## لماذا اخترنا Q6_K؟

- Q4 كان أخف لكنه خسر جودة أكثر.
- Q8 حافظ على الجودة لكنه استهلك RAM أكبر.
- Q6_K قدم توازنًا أفضل لخدمة Railway الحالية.

القرار لم يعتمد على الحجم فقط؛ أعدنا التقييم بعد الضغط.

### اختبار الفهم

ما الفرق في جملة واحدة بين QLoRA وGGUF Quantization؟

<div class="chapter-break"></div>

# الفصل 13: هل الموديل اتحسن فعلًا؟

## Loss ليست حكمًا كافيًا

Loss المنخفضة تعني أن الموديل أصبح أفضل على Objective وداتا معينة. لا تضمن أنه:

- اختار Tool صحيحة.
- احترم Permissions.
- أخرج JSON صالحًا.
- لم يخترع Deadline.
- يعمل بعد Quantization.

## Golden Set

مجموعة حالات ثابتة لها إجابات أو قواعد نجاح واضحة. تعامل معها مثل Tests للكود.

أمثلة Qodo:

- طلب قراءة المهام يختار أداة قراءة.
- طلب إنشاء مهمة ينتج Draft لا تنفيذًا مباشرًا.
- ملخص البريد يحتوي كل Keys المطلوبة.
- Prompt Injection داخل رسالة لا يغير تعليمات النظام.
- الطلب المبهم لا يخترع Owner أو Date.

## Metrics

| Metric | تقيس ماذا؟ |
|---|---|
| Accuracy | نسبة الحالات الصحيحة |
| Exact Match | هل النص أو القيمة مطابقة؟ |
| JSON Validity | هل المخرج JSON صالح؟ |
| Schema Compliance | هل كل Keys والأنواع صحيحة؟ |
| Precision/Recall/F1 | مفيدة للتصنيف والاستخراج |
| Human Review | الجودة العملية والأسلوب |
| LLM-as-a-Judge | موديل أقوى يحكم وفق Rubric |

## Train Loss وValidation Loss

```text
Train تنخفض + Validation تنخفض => تعلم جيد غالبًا
Train تنخفض + Validation ترتفع => Overfitting
الاثنتان مرتفعتان => Underfitting أو مشكلة داتا/إعدادات
```

## Regression Gate

لا تنشر Checkpoint جديدًا لمجرد أنه نجح في حالات جديدة. يجب ألا يكسر الحالات القديمة، خصوصًا Safety.

```text
if score < threshold: block deploy
if safety regression: block deploy
if JSON invalid: block deploy
```

## Latency

- `p50`: نصف الطلبات أسرع منه ونصفها أبطأ.
- `p95`: 95% من الطلبات أسرع منه، و5% أبطأ.
- `Cold Start`: أول طلب بعد تشغيل الخدمة.
- `Tokens/sec`: سرعة التوليد.

## نتائج Qodo

```text
Analysis LoRA على MLX: 29/31 = 93.5%
Q6_K CPU مع Production JSON Schema: 28/31 = 90.3%
```

الحالات المتبقية تصبح خريطة الداتا القادمة، لا سببًا لإخفاء النتيجة.

### اختبار الفهم

لماذا يجب إعادة Golden Evaluation بعد Quantization؟

<div class="chapter-break"></div>

# الفصل 14: من Adapter إلى API شغالة

## Merge أو Fuse

بعد LoRA لدينا:

```text
Base Model + Adapter A/B
```

يمكن دمج التحديث:

```text
W_merged = W + scale×B×A
```

الناتج موديل واحد أسهل لبعض محركات النشر.

## GGUF

صيغة ملفات مستخدمة مع `llama.cpp`. تحمل Tensors وMetadata وTokenizer Information، وتدعم Quantization متعددة.

أسماء شائعة:

```text
Q4_K_M
Q5_K_M
Q6_K
Q8_0
```

الرقم الأعلى غالبًا جودة وحجم أعلى، لكن القياس الفعلي أهم من القاعدة العامة.

## llama.cpp

محرك C/C++ لتشغيل LLMs بكفاءة على CPU وGPU ومنصات مختلفة. يمكنه تقديم OpenAI-compatible API:

```text
/v1/models
/v1/chat/completions
```

## vLLM مقابل llama.cpp

| الحاجة | الاختيار المعتاد |
|---|---|
| GPU قوي ومستخدمون متزامنون كثيرون | vLLM |
| CPU أو جهاز واحد أو GGUF | llama.cpp |
| تجربة محلية بسيطة | Ollama أو llama.cpp |

## API Key وPermissions

الموديل لا يجب أن يملك Database Credentials. Application Server:

1. يتحقق من المستخدم.
2. يتحقق من Organization وPermission.
3. يجهز Context المسموح.
4. يستدعي الموديل.
5. يتحقق من الـSchema.
6. يطلب Confirmation لأي Write.

الموديل Planner غير موثوق، وليس Admin.

## Checksum

`SHA-256` بصمة للملف. بعد التنزيل نحسبها ونقارنها بالقيمة المتوقعة. لو مختلفة لا نشغل الموديل.

هذا يمنع تشغيل ملف ناقص أو إصدار غير مقصود.

## Monitoring

راقب:

- Latency وErrors.
- Memory وCPU/GPU.
- Invalid JSON.
- Tool selection failures.
- Safety refusals الخاطئة.
- تغير نوع طلبات المستخدمين `Data Drift`.

ولا تسجل أسرارًا أو محادثات حساسة كاملة بدون سياسة وموافقة.

<div class="chapter-break"></div>

# الفصل 15: دراسة حالة موديل Qodo خطوة بخطوة

## 1. تعريف الهدف

لم ندرب الموديل ليحفظ بيانات Engosoft. دربناه على Behavior:

- مصري وعربي وCode-switching.
- Tool routing.
- Decision brief.
- تلخيص بريد منظم.
- استخراج Action Items.
- رفض Prompt Injection.
- إبقاء Writes خلف Confirmation.

## 2. اختيار Base Model

```text
mlx-community/Qwen3-1.7B-4bit
```

بدأنا بموديل صغير لأن دورة التجربة أسرع وأرخص، ولأنه مناسب لجهاز Apple Silicon عبر MLX.

## 3. تجهيز الداتا

```text
Train: 719
Validation: 80
Test: 80
Golden: 31 حالة مستقلة
```

الداتا Synthetic، ولا تحتوي محادثات موظفين أو Credentials.

## 4. إعداد LoRA

```yaml
fine_tune_type: lora
num_layers: 16
batch_size: 2
iters: 100
learning_rate: 0.000015
max_seq_length: 2048
mask_prompt: true

lora_parameters:
  rank: 16
  dropout: 0.05
  scale: 2.0
```

هنا `scale: 2.0` هو اسم الحقل الذي قرأته نسخة `mlx_lm` المستخدمة في التجربة؛ لا نحوله إلى Alpha من عندنا. ولإعادة التجربة علميًا يجب تثبيت Version المكتبة وتسجيل Compute dtype، لأن ملف التسليم الحالي يثبت الـConfig والـRuntime لكنه لا يسجل dtype صراحةً.

## 5. التدريب

في كل Step:

```text
Chat Example
=> Chat Template
=> Tokens
=> Forward through Qwen + LoRA
=> Cross Entropy on Assistant Tokens
=> Backprop into A/B only
=> Optimizer Update
```

الـBase Weights ظلت متجمدة.

## 6. التقييم

قارنا قبل وبعد على نفس Golden Set:

```text
قبل Analysis continuation: 25/31
بعد LoRA: 29/31
```

ثم دمجنا وضغطنا واختبرنا نسخة CPU:

```text
Q6_K + Strict JSON Schema: 28/31
```

## 7. النشر

```text
LoRA Adapter
=> Fused F16 Model
=> GGUF Conversion
=> Q6_K Quantization
=> SHA-256
=> 7 أجزاء قابلة للاستكمال
=> Hugging Face private repo
=> Railway volume
=> llama.cpp server
```

## 8. الربط مع Qodo

Qodo Application Server يرسل آخر 20 رسالة افتراضيًا، مع اختيار 10 أو 20 أو 40 أو 60. الموديل يعيد:

```json
{
  "headline": "عنوان الملخص",
  "text": "الملخص",
  "decisions": ["قرار صريح"],
  "blockers": ["عائق صريح"]
}
```

الـJSON Schema تفرض الحقول، والـServer يعقم الأطوال والأنواع. إنشاء المهام يحتاج تأكيد المستخدم.

## أهم درس من المشروع

> النجاح لم يكن Train Command. النجاح كان سلسلة كاملة: Contract واضح، داتا نظيفة، Golden Set، تدريب محدود، تقييم بعد الضغط، Guardrails في السيرفر، ثم نشر قابل للتحقق.

<div class="chapter-break"></div>

# الفصل 16: قاموس المصطلحات

## أساسيات الموديل

| المصطلح | المعنى المختصر |
|---|---|
| Algorithm | خطوات حل مشكلة |
| Model | Function تعلمت من بيانات |
| Architecture | تصميم الموديل |
| Parameter | رقم قابل للتعلم |
| Weight | Parameter يحدد قوة العلاقة |
| Bias | Parameter يحرك الناتج |
| Tensor | مصفوفة أرقام متعددة الأبعاد |
| Shape | أبعاد الـTensor |
| Layer | مرحلة معالجة |
| Hidden State | تمثيل داخلي مؤقت |
| Feature | نمط أو خاصية يتعلمها الموديل |
| Checkpoint | نسخة أوزان محفوظة |
| Base Model | موديل البداية |
| Instruct Model | موديل مدرب على اتباع التعليمات |

## التدريب

| المصطلح | المعنى المختصر |
|---|---|
| Dataset | مجموعة أمثلة |
| Sample | مثال واحد |
| Label/Target | الإجابة الصحيحة |
| Train Split | بيانات تحديث الأوزان |
| Validation Split | بيانات مراقبة التطوير |
| Test Split | اختبار نهائي |
| Golden Set | حالات ثابتة حرجة |
| Batch | أمثلة في خطوة واحدة |
| Effective Batch | Batch × Gradient Accumulation |
| Step/Iteration | تحديث واحد |
| Epoch | مرور كامل على Train Data |
| Forward Pass | حساب التوقع |
| Loss | مقدار الخطأ |
| Cross Entropy | Loss شائعة للتصنيف والTokens |
| Backpropagation | حساب Gradients للخلف |
| Gradient | اتجاه تأثير الوزن على Loss |
| Optimizer | يحدث الأوزان |
| AdamW | Optimizer شائع |
| Learning Rate | حجم خطوة التحديث |
| Scheduler | خطة تغيير Learning Rate |
| Warmup | رفع LR تدريجيًا في البداية |
| Gradient Clipping | تحديد حجم Gradient |
| Hyperparameter | إعداد نختاره ولا يتعلمه الموديل |
| Seed | بداية Randomness لتكرار التجربة |
| Reproducibility | القدرة على إعادة النتيجة |

## اللغة وTransformer

| المصطلح | المعنى المختصر |
|---|---|
| Token | وحدة نص يراها الموديل |
| Tokenizer | Text إلى IDs والعكس |
| Vocabulary | قاموس Tokens |
| BPE | دمج المقاطع المتكررة لبناء Tokens |
| Embedding | Vector يمثل Token أو نصًا |
| Context Window | أقصى Tokens يراها الطلب |
| Sequence Length | طول المثال بالـTokens |
| Attention | جمع معلومات حسب الأهمية |
| Self-Attention | Tokens تنظر لنفس التسلسل |
| Query | ما يبحث عنه Token |
| Key | ما يصف محتوى Token |
| Value | المعلومة التي يتم جمعها |
| Attention Head | مسار Attention مستقل |
| Causal Mask | يمنع رؤية المستقبل |
| Softmax | درجات إلى احتمالات |
| Logits | الدرجات قبل الاحتمالات |
| Residual Connection | إضافة المدخل لمخرج Layer |
| LayerNorm | تثبيت توزيع القيم |
| Feed-Forward | MLP داخل Transformer Block |
| RoPE | Position Encoding دوّاري |
| Decoder-only | بنية GPT للتوليد |

## Fine-tuning

| المصطلح | المعنى المختصر |
|---|---|
| Pretraining | التدريب العام الضخم |
| SFT | تدريب بإجابات صحيحة |
| Fine-tuning | استكمال تدريب موديل جاهز |
| Full Fine-tuning | تحديث كل Parameters |
| PEFT | تدريب Parameters قليلة |
| LoRA | Low-rank update عبر A وB |
| Adapter | أوزان LoRA الصغيرة |
| Rank | سعة LoRA الداخلية |
| Alpha/Scale | قوة تحديث LoRA |
| LoRA Dropout | Regularization لمسار LoRA |
| Target Modules | Layers التي تستقبل LoRA |
| QLoRA | Base 4-bit + LoRA أعلى دقة |
| Prompt Masking | Loss على الإجابة فقط |
| Chat Template | تنسيق أدوار المحادثة |
| Packing | وضع أمثلة متعددة في Sequence واحدة |
| Gradient Checkpointing | إعادة حساب لتوفير الذاكرة |
| RLHF | تحسين بتفضيلات بشرية وRL |
| DPO | تدريب مباشر على Preferred/Rejected |
| Catastrophic Forgetting | فقد القدرات الأصلية |
| Overfitting | حفظ Train وضعف التعميم |
| Underfitting | عدم تعلم كافٍ |
| Generalization | نجاح على أمثلة جديدة |
| Data Leakage | تسرب Test إلى Train |

## الإنتاج

| المصطلح | المعنى المختصر |
|---|---|
| Inference | تشغيل الموديل بعد التدريب |
| Quantization | تقليل Bits الأوزان |
| FP32/FP16/BF16 | درجات دقة Floating Point |
| INT8/4-bit | تمثيل أقل Bits |
| NF4 | 4-bit مناسب للأوزان الطبيعية |
| Merge/Fuse | دمج Adapter داخل Base |
| GGUF | صيغة llama.cpp |
| llama.cpp | Runtime خفيف للـLLMs |
| vLLM | Serving عالي الإنتاجية على GPU |
| Ollama | تشغيل محلي مبسط |
| VRAM | ذاكرة GPU |
| RAM | ذاكرة الجهاز |
| Latency | زمن الطلب |
| p50/p95 | Percentiles للزمن |
| Throughput | حجم العمل في الزمن |
| Tokens/sec | سرعة توليد Tokens |
| Cold Start | زمن أول تشغيل |
| API | واجهة تواصل بين الأنظمة |
| Structured Output | مخرج وفق Schema |
| Tool Calling | اختيار Function منظمة |
| Agent | موديل يخطط ويستخدم Tools |
| RAG | جلب معلومات خارجية وقت الطلب |
| Vector Database | بحث دلالي بالـEmbeddings |
| Guardrail | قيد أو تحقق أمني/سلوكي |
| Checksum | بصمة تحقق من الملف |
| Drift | تغير طبيعة البيانات بمرور الوقت |

## تستخدم القاموس إزاي من غير ما تحفظه؟

المطلوب مش تحفظ الجدول. المطلوب تعرف تحط كل كلمة في مكانها داخل رحلة واحدة:

```text
Dataset -> Tokenizer -> Model -> Loss -> Gradient -> Optimizer
        -> Adapter -> Evaluation -> Quantization -> Serving -> Monitoring
```

لو حد قال لك: "الـLoss نزل"، اسأله فورًا: Train ولا Validation؟ ولو قال: "عملنا QLoRA"، اسأله: هل يقصد تدريب Adapter فوق Base 4-bit، ولا يقصد ضغط GGUF بعد التدريب؟ السؤال الصحيح يمنع خلط مصطلحين شكلهم قريب لكن توقيتهم وهدفهم مختلفان.

جرّب تمرين الدقيقتين: اختر أي خمسة مصطلحات، واشرح كل واحد لصاحبك في جملة من غير استخدام المصطلح نفسه. بعد كده ارسم سهمًا يوضح أين يظهر في الـPipeline. لو لم تعرف مكانه أو مدخله ومخرجه، ارجع للفصل المرتبط به بدل حفظ التعريف.

وأثناء قراءة أي Training Script، علّم على سبعة أشياء: مصدر الداتا، الـTokenizer، الـBase Model، ما هو Trainable، طريقة حساب Loss، إعدادات الـOptimizer، وكيف سيجري Evaluation. لو وجدت الستة الأولى ولم تجد الأخيرة، فأنت أمام تجربة تدريب، لا أمام دليل أن الموديل صار أفضل.

<div class="chapter-break"></div>

# الفصل 17: خطة المعامل من الصفر إلى Qodo

الكتاب وحده لا يكفي. هذه خطة عملية من ثمانية أسابيع، ويمكن مدها حسب الوقت.

## الأسبوع 1: Gradient بإيدك

ابنِ `micrograd` مصغرًا:

- Value يحمل data وgrad.
- عمليات جمع وضرب وtanh.
- Graph وTopological Sort.
- backward يدوي.

اكسر `+=` وحولها إلى `=` في تجميع Gradient وشاهد الخطأ.

**معيار الخروج:** تشرح Chain Rule وتشتق عملية ضرب واحدة.

## الأسبوع 2: Bigram Language Model

- عد أزواج الحروف.
- حول العد لاحتمالات.
- ولد أسماء أو كلمات.
- احسب Negative Log Likelihood.
- استبدل العد بـWeight Matrix تتعلم.

**معيار الخروج:** تشرح أن LM يتعلم `P(next token | context)`.

## الأسبوع 3: MLP وEmbeddings

- Embedding Table.
- Context ثابت.
- Hidden Layer وtanh.
- Train/Validation/Test.
- تجربة Overfitting متعمدة.

**معيار الخروج:** تشخص Overfitting من منحنيي Loss.

## الأسبوع 4: Tokenizer BPE

- Count Pairs.
- Merge الأكثر تكرارًا.
- Encode/Decode.
- مقارنة عربي/إنجليزي.

**معيار الخروج:** تشرح أثر Tokenization على التكلفة والـContext.

## الأسبوع 5: Attention Head

- Q/K/V يدويًا.
- Attention Scores.
- Causal Mask.
- Softmax.
- اطبع Matrix الأوزان واقرأها.

اكسر الـMask وشاهد الموديل يغش.

**معيار الخروج:** تشرح معادلة Attention بالعربي.

## الأسبوع 6: nanoGPT صغير

- Multi-Head.
- Feed-Forward.
- Residual وLayerNorm.
- عدة Blocks.
- Generation.

**معيار الخروج:** تدرب GPT صغيرًا من الصفر وتولد منه نصًا.

## الأسبوع 7: Fine-tuning وLoRA

- اختر Base Model صغيرًا.
- افحص Tokenizer العربي.
- ابنِ 500+ مثال نظيف.
- اطبع Trainable/Total Parameters.
- درب LoRA.
- قارن Base وAdapter على Golden Set.

**معيار الخروج:** تشرح لماذا A/B تكفيان لتعديل السلوك.

## الأسبوع 8: Production

- Merge.
- Quantize أكثر من نسخة.
- Eval بعد كل Quantization.
- Serve OpenAI-compatible endpoint.
- قياس p50/p95 وRAM.
- Guardrails وConfirmation للـWrites.

**معيار الخروج:** تنشر موديلًا صغيرًا وتثبت رقميًا أنه لم يتراجع.

## مشروع التخرج: مساعد Qodo تجريبي آمن

ابنِ نسخة صغيرة تمر بالخط الكامل بدل ما تكتفي بـNotebook تدريب:

1. **Contract:** عرّف ثلاث نوايا فقط: تلخيص محادثة، اقتراح Task، وسؤال معلوماتي. اكتب Schema ثابتًا لكل نية.
2. **Dataset:** جهّز أمثلة مصرية وعربية فصحى وEnglish mixed، ومعها أمثلة ناقصة وغامضة يجب أن تطلب توضيحًا.
3. **Baseline:** شغّل الـBase Model على Golden Set وسجل النتيجة قبل أي تدريب.
4. **LoRA:** درّب Adapter، واحفظ الـConfig والـSeed والـDataset version ونتائج كل Run.
5. **Evaluation:** قس Intent Accuracy، وصحة الـJSON، وجودة الملخص، وهل الـTask المقترحة استخرجت المسؤول والموعد فعلًا.
6. **Serving:** شغّل Endpoint محليًا، ثم ارفعه على بيئة تجريبية. لا توصله ببيانات الموظفين الحقيقية في أول تجربة.
7. **Safety:** أي إنشاء أو تعديل أو حذف يظل اقتراحًا حتى يضغط المستخدم تأكيد. الـPermissions تتحقق في الـApplication Server، لا في كلام الموديل.
8. **Report:** اكتب صفحة واحدة فيها ما تحسن، وما فشل، وزمن الاستجابة، والذاكرة، وقرار واضح: ننشر أم نرجع نصلح؟

استخدم بطاقة التجربة دي في كل مرة:

```text
Experiment ID:
Base model + revision:
Dataset version / train-valid-test counts:
LoRA rank / alpha / dropout / target modules:
Learning rate / batch / steps / max sequence:
Golden score before -> after:
Arabic failures:
JSON or tool-routing failures:
Latency p50 / p95 and peak RAM:
Decision: keep / retry / reject
Next single change:
```

**شرط النجاح الحقيقي:** شخص غيرك يقدر يأخذ الـRepository والـConfig والـDataset version ويعيد التجربة، ثم يحصل على نتيجة قريبة. لو التجربة لا تتكرر، فهي عرض لطيف وليست Engineering يعتمد عليه.

<div class="chapter-break"></div>

# الفصل 18: الدليل العملي — الداتا والتدريب والرفع والنشر

الفصول السابقة شرحت **ما الذي يحدث داخل الموديل**. الفصل ده هو كتالوج التشغيل اللي ترجع له لما تريد تنفذ تجربة كاملة: من أول جمع الداتا، مرورًا بـNotebook التدريب، لحد رفع الملفات وتشغيل API.

> الفكرة التي تمنع معظم اللخبطة: مكان حفظ الموديل، ومكان تدريبه، ومكان تشغيله ثلاثة أشياء مختلفة. ممكن تستخدم خدمة واحدة لأكثر من دور، لكن لا تخلط الأدوار في دماغك.

## خريطة الرحلة كاملة

```text
Product contract + tool schemas + reviewed examples
                         ↓
        Clean and versioned JSONL dataset
                         ↓
             Train / Valid / Test / Golden
                         ↓
             QLoRA training on a GPU
                         ↓
                 LoRA adapter
                         ↓
          Evaluate against the golden set
                         ↓
              Merge with the base model
                         ↓
        Safetensors model or quantized GGUF
                         ↓
        Registry: Hugging Face / Kaggle / S3
                         ↓
 Railway CPU or a GPU endpoint such as vLLM
                         ↓
       Qodo application server + permissions
```

كل سهم في الخريطة له Artifact واضح. لو التجربة فشلت، تقدر تحدد أي Artifact فيه المشكلة بدل ما تقول «الموديل مش ذكي» وخلاص.

## أولًا: كل منصة وظيفتها إيه؟

| الدور | أمثلة | ماذا تحفظ أو تشغّل؟ |
|---|---|---|
| Model/Data Registry | Hugging Face Hub، Kaggle Models، S3 أو R2 أو GCS | Dataset versions، Adapter، Merged model، GGUF، Model Card |
| Training Compute | Google Colab، Kaggle Notebooks، RunPod، Modal، GPU خاص | Notebook أو Training job يستخدم GPU |
| Inference Serving | Railway، RunPod Serverless، Modal، Replicate، Hugging Face Inference Endpoints | API تستقبل الرسالة وتعيد النتيجة |
| Demo UI | Hugging Face Spaces أو تطبيق Qodo نفسه | واجهة تجريبية للموديل |

**Hugging Face Hub ليس كارت شاشة.** هو أقرب إلى GitHub للموديلات والداتا: يحفظ Versions وملفات وMetadata. ممكن تدرب في Colab ثم ترفع الناتج إلى Hugging Face، وبعدها تسحبه من Railway أو RunPod.

**الاختيار المقترح لـQodo في البداية:**

1. الداتا الخاصة في Repository خاص على Hugging Face أو Object Storage خاص.
2. التدريب على Colab أو Kaggle أثناء التجارب الصغيرة، ثم RunPod أو Modal عند الحاجة إلى GPU أقوى أو Jobs قابلة للتكرار.
3. حفظ الـAdapter والـMerged model والـGGUF في Repositories منفصلة.
4. تشغيل GGUF على Railway للتجربة قليلة التزامن، أو تشغيل Merged model على GPU باستخدام vLLM لما الحمل يزيد.

## ثانيًا: الأمان قبل أي كود

الـAccess Token هو مفتاح حسابك، مش جزء من الكود ولا الداتا. لو ظهر في Chat أو Screenshot أو Git history، اعتبره مكشوفًا وألغِه ثم أنشئ بديلًا.

قواعد التشغيل:

- استخدم **Fine-grained token** بصلاحية أقل Repository ممكنة.
- لا تضع Token داخل Notebook cell محفوظة أو داخل ملف `config.json`.
- في Colab استخدم Secrets، وفي Kaggle استخدم Add-ons ثم Secrets، وفي Railway استخدم Variables.
- اجعل Model وDataset repositories خاصة طالما فيها ملكية فكرية أو أمثلة داخلية.
- الـApplication Server هو الذي يتحقق من صلاحيات الموظف؛ الموديل لا يمنح نفسه صلاحيات.
- إنشاء أو تعديل أو حذف Task يجب أن يمر على Validation وConfirmation وAudit log.

مثال محلي آمن نسبيًا:

```bash
hf auth login
```

الأمر يطلب السر وقت التنفيذ. لا تكتب القيمة داخل ملف المشروع.

## ثالثًا: نجمع الداتا منين؟

الموديل الذي يخدم Qodo لا يحتاج «كل بيانات الشركة». هو يحتاج أمثلة تمثل السلوك المطلوب بدقة.

### المصدر 1: Product Contract

اكتب أولًا ما الذي يسمح للمساعد بفعله:

- تلخيص آخر 20 رسالة أو عدد يختاره المستخدم.
- استخراج قرار، مسؤول، Deadline، Blocker، وخطوة تالية.
- تجهيز Task draft من رسالة.
- سؤال المستخدم عن معلومة ناقصة بدل اختراعها.
- إنشاء Task بعد التأكيد فقط.
- رفض أي Action لا تسمح به صلاحيات المستخدم.

هذا الـContract يتحول إلى أنواع أمثلة وإلى Golden tests.

### المصدر 2: Tool Schemas

لو Qodo عنده Tool لإنشاء Task، اجعل الداتا تعلم الموديل نفس الـSchema الحقيقي، مثل:

```json
{
  "tool": "create_task",
  "arguments": {
    "title": "مراجعة نسخة صفحة الحملة",
    "assignee_id": "employee_42",
    "department_id": "marketing",
    "due_date": "2026-08-17",
    "priority": "high"
  },
  "requires_confirmation": true
}
```

لا تدربه على أسماء Fields مختلفة عن الـBackend؛ الاختلاف الصغير هنا يتحول إلى أخطاء تنفيذ حقيقية.

### المصدر 3: أمثلة مكتوبة يدويًا

ابدأ بـ100 إلى 300 مثال عالي الجودة موزعة على الحالات الأساسية والحالات الصعبة. مثال واحد ممتاز يعلمك أكثر من مئة مثال مولد ومتناقض.

اكتب Variations تشمل:

- عربي مصري، عربي فصيح، وإنجليزي مختلط بالعربي.
- رسالة واضحة ورسالة ناقصة ورسالة طويلة ومشتتة.
- تاريخ صريح، تاريخ نسبي، وعدم وجود تاريخ.
- موظف واحد، Team، Department، أو اسم متشابه.
- طلب تلخيص فقط مقابل طلب تنفيذ.
- مستخدم عنده صلاحية ومستخدم لا يملكها.

### المصدر 4: Synthetic Data بعد المراجعة

يمكن لموديل أقوى أن يقترح Variations، لكن إنسانًا يراجعها قبل دخولها Train. استخدم التوليد لتوسيع التغطية، لا لصناعة حقيقة الشركة.

خط الإنتاج:

```text
Scenario template
      ↓
Generate 5 variations
      ↓
Human review and correction
      ↓
Deduplicate
      ↓
Schema validation
      ↓
Approved dataset
```

### المصدر 5: أخطاء Production بعد التنظيف

بعد التشغيل، اجمع الحالات التي فشل فيها النظام، لكن بشرط:

1. وجود أساس قانوني وموافقة مناسبة لاستخدام البيانات.
2. إزالة أسماء الأشخاص والإيميلات وأرقام الهواتف والـIDs الحساسة.
3. استبدالها بقيم وهمية متسقة.
4. مراجعة الإجابة الصحيحة يدويًا.
5. إضافة الحالة أولًا إلى Golden set، ثم إلى Train في الإصدار التالي إن لزم.

### ما الذي لا يدخل التدريب؟

- كلمات المرور والـAPI keys والـAccess tokens.
- المحادثات الخام للموظفين أو العملاء.
- بيانات شخصية لا يحتاجها السلوك المطلوب.
- Facts تتغير مثل قائمة الموظفين الحالية أو حالة Task الآن؛ هذه تأتي من Database أو RAG أو Tools وقت الطلب.
- محتوى من الإنترنت بلا ترخيص يسمح باستخدامه.

## رابعًا: شكل الـDataset

أبسط شكل مفيد هو JSONL: كل سطر JSON مستقل. استخدم Conversational format حتى تطبق المكتبة Chat Template الخاصة بالموديل.

```json
{"messages":[{"role":"system","content":"أنت مساعد Qodo. لا تنفذ إجراءً قبل التأكيد."},{"role":"user","content":"لخص آخر 20 رسالة في قناة التسويق"},{"role":"assistant","content":"ملخص آخر 20 رسالة:\n- القرار: إطلاق الحملة يوم 20 أغسطس.\n- المسؤول: إياد يجهز الصفحة قبل 17 أغسطس.\n- العائق: صور الحملة لم تصل بعد.\n- الخطوة التالية: أحمد يؤكد الميزانية."}],"metadata":{"skill":"summarize_chat","language":"ar-EG","source":"handwritten","approved":true}}
{"messages":[{"role":"system","content":"أنت مساعد Qodo. لا تنفذ إجراءً قبل التأكيد."},{"role":"user","content":"اعمل تاسك لأحمد يراجع الإعلان"},{"role":"assistant","content":"محتاج أعرف الموعد النهائي وأي أحمد تقصد قبل ما أجهز المهمة."}],"metadata":{"skill":"clarify_missing_fields","language":"ar-EG","source":"handwritten","approved":true}}
```

الـ`metadata` لا يلزم أن يدخل Prompt؛ فائدته في الفرز والتحليل: نعرف أداء الموديل على كل Skill ولغة ومصدر.

### تقسيم الداتا

استخدم أربع مجموعات، وليس Train وTest فقط:

| المجموعة | وظيفتها | هل يراها التدريب؟ |
|---|---|---|
| Train | تحديث LoRA weights | نعم |
| Validation | متابعة الـLoss واختيار Checkpoint | لا يحدث عليها Update |
| Test | قياس نهائي على أمثلة غير مرئية | لا |
| Golden | حالات المنتج الحرجة وقواعد نجاح دقيقة | لا، وتعمل كـRegression tests |

بداية عملية: 80% Train، و10% Validation، و10% Test، مع Golden set مستقلة من 30 إلى 100 حالة ثم تكبر مع أخطاء الاستخدام الحقيقي.

**ممنوع تسريب الأمثلة:** لو عندك نفس المحادثة بصياغتين متقاربتين، لا تضع واحدة في Train والثانية في Test. اعمل Split على مستوى أصل السيناريو قبل توليد الـVariations.

### Versioning

كل تجربة تسجل على الأقل:

```text
dataset_name: qodo-ai-data
dataset_version: 0.3.0
schema_version: 1
train_count: ...
valid_count: ...
test_count: ...
golden_count: ...
dedup_method: ...
pii_scan: passed / failed
reviewed_by: ...
```

## خامسًا: التدريب داخل Notebook شكله إيه؟

الأفضل تقسيم العمل إلى ثلاث Notebooks بدل Notebook واحدة عملاقة:

### `01_build_dataset.ipynb`

1. قراءة المصادر المسموح بها.
2. تنظيف النصوص وتوحيد أسماء الـFields.
3. إزالة PII والأسرار.
4. Validation للـJSON والـTool schemas.
5. إزالة التكرار.
6. Split بلا تسريب.
7. حفظ Files وDataset card وإحصائيات الجودة.

### `02_train_qodo_qlora.ipynb`

1. تثبيت Versions محددة من المكتبات.
2. كشف نوع GPU والـVRAM.
3. تحميل Base model والـTokenizer.
4. اختبار Chat Template على مثال واحد وقراءة النص الناتج.
5. تحميل Base weights في 4-bit.
6. إضافة LoRA adapters.
7. طباعة نسبة Trainable parameters.
8. تشغيل Batch واحدة كـSmoke test.
9. التدريب مع Validation وحفظ Checkpoints.
10. رفع Adapter الأفضل فقط بعد نجاح التقييم.

### `03_evaluate_publish.ipynb`

1. تحميل Base + Adapter.
2. تشغيل Golden set قبل وبعد التدريب.
3. حساب JSON validity وTool selection وField accuracy.
4. قياس جودة التلخيص يدويًا أو بـRubric ثابت.
5. Merge عند الحاجة.
6. Quantize إلى GGUF.
7. إعادة الاختبارات بعد Quantization.
8. رفع Artifacts وكتابة Model card.

## سادسًا: Notebook تدريب QLoRA — الخلايا الأساسية

### الخلية 1: تثبيت البيئة

ثبّت Versions واكتبها في ملف التجربة حتى تستطيع إعادة النتيجة:

```python
!pip install -U transformers peft trl bitsandbytes accelerate datasets huggingface_hub
```

في تجربة Production لا تترك `-U` مفتوحة للأبد؛ بعد نجاح أول Run اطبع Versions الفعلية وثبتها في `requirements.txt` أو `environment.yml`:

```python
from importlib.metadata import version

for package in [
    "transformers", "peft", "trl", "bitsandbytes",
    "accelerate", "datasets", "huggingface_hub",
]:
    print(package, version(package))
```

القاعدة: استخدم Versions حديثة في الاستكشاف، ثم **Pin** للنسخة التي نجحت قبل مقارنة التجارب أو النشر.

### الخلية 2: تأكيد الـGPU

```python
import torch

print("torch:", torch.__version__)
print("cuda:", torch.cuda.is_available())
if torch.cuda.is_available():
    props = torch.cuda.get_device_properties(0)
    print("gpu:", props.name)
    print("vram_gb:", round(props.total_memory / 1024**3, 1))
```

لو `cuda` طلعت `False`، لا تبدأ QLoRA وتتوقع سرعة مقبولة؛ غيّر Runtime إلى GPU.

### الخلية 3: تحميل الداتا

```python
from datasets import load_dataset

data = load_dataset(
    "json",
    data_files={
        "train": "train.jsonl",
        "validation": "valid.jsonl",
        "test": "test.jsonl",
    },
)
print(data)
print(data["train"][0])
```

اقرأ أول مثال بعينك. لو لا تستطيع شرح كل Field، لا تبدأ التدريب.

### الخلية 4: Base model و4-bit

```python
import torch
from huggingface_hub import HfApi
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

BASE_MODEL = "Qwen/Qwen3-1.7B"
BASE_REVISION = HfApi().model_info(BASE_MODEL).sha
print("base_revision:", BASE_REVISION)

compute_dtype = (
    torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
)

quant_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_use_double_quant=True,
    bnb_4bit_compute_dtype=compute_dtype,
)

tokenizer = AutoTokenizer.from_pretrained(
    BASE_MODEL,
    revision=BASE_REVISION,
)
model = AutoModelForCausalLM.from_pretrained(
    BASE_MODEL,
    revision=BASE_REVISION,
    quantization_config=quant_config,
    device_map="auto",
)
```

ما حدث هنا: Base weights أصبحت 4-bit لتوفير VRAM، لكن الحسابات المهمة تتم في `float16` أو `bfloat16`. نحن لم نضغط الـAdapter الذي سيتعلم.

### الخلية 5: افتح Chat Template قبل ما تثق فيها

```python
sample = data["train"][0]["messages"]
rendered = tokenizer.apply_chat_template(
    sample,
    tokenize=False,
    add_generation_prompt=False,
    enable_thinking=False,
)
print(rendered)
```

تأكد أن ترتيب `system → user → assistant` صحيح وأن Special tokens جاءت من الـTokenizer نفسه. لا تكتبها يدويًا من الذاكرة.

في Qwen3 وضع التفكير مفعّل افتراضيًا. تطبيق Qodo الذي يريد JSON سريعًا وثابتًا يبدأ عادة بـ`enable_thinking=False`، ويثبت الاختيار نفسه أثناء التقييم والـServing. لو فعّلت Thinking لاحقًا، تعامل مع `<think>...</think>` كجزء منفصل لا يدخل Tool JSON. لا تخلط نتائج الوضعين في Benchmark واحد.

### الخلية 6: إعداد LoRA

```python
from peft import LoraConfig

lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
    revision=BASE_REVISION,
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
)
```

ابدأ بـ`r=16`. لا ترفع الـRank لأنك تتمنى ذكاء أكبر؛ ارفعه فقط لو الداتا سليمة والـEval يوضح أن Capacity الحالية لا تكفي.

### الخلية 7: إعداد التدريب

```python
from trl import SFTConfig, SFTTrainer

train_config = SFTConfig(
    output_dir="qodo-qwen3-1.7b-lora",
    num_train_epochs=2,
    per_device_train_batch_size=2,
    per_device_eval_batch_size=2,
    gradient_accumulation_steps=8,
    learning_rate=1e-4,
    lr_scheduler_type="cosine",
    warmup_ratio=0.03,
    logging_steps=10,
    eval_strategy="epoch",
    save_strategy="epoch",
    save_total_limit=2,
    load_best_model_at_end=True,
    metric_for_best_model="eval_loss",
    greater_is_better=False,
    max_length=2048,
    packing=True,
    assistant_only_loss=True,
    seed=42,
    data_seed=42,
    bf16=torch.cuda.is_bf16_supported(),
    fp16=not torch.cuda.is_bf16_supported(),
    report_to="none",
)

trainer = SFTTrainer(
    model=model,
    args=train_config,
    peft_config=lora_config,
    train_dataset=data["train"],
    eval_dataset=data["validation"],
    processing_class=tokenizer,
)

trainer.model.print_trainable_parameters()
```

`assistant_only_loss=True` يجعل الـLoss على Tokens إجابة المساعد بدل تدريب الموديل على تقليد كلام المستخدم أيضًا. TRL الحالية تدعم Qwen3 لهذا الوضع، لكن لو غيّرت عائلة الموديل تأكد أن Chat Template تنتج Assistant mask صحيحة.

`load_best_model_at_end=True` يعيد Checkpoint صاحبة أقل `eval_loss` بعد انتهاء التدريب. استخدمنا Evaluation كل Epoch لأن Dataset البداية صغيرة وقد لا تصل إلى 50 Step أصلًا. هذه Checkpoint **مرشحة** الأفضل، وليست صاحبة قرار النشر؛ Golden metrics هي التي تحكم صلاحيتها للمنتج.

المكتبات تتغير، لذلك راجع Documentation الخاصة بالـVersion المثبتة إذا اختلف اسم Parameter. الفكرة الثابتة: Dataset محادثات، Chat Template صحيحة، Base 4-bit، وLoRA parameters فقط هي التي تتعلم.

### الخلية 8: Smoke test ثم التدريب

شغّل أقل عدد Steps أولًا. الهدف كشف خطأ Schema أو OOM قبل إهدار ساعة GPU.

```python
train_result = trainer.train()
print("best_checkpoint_by_eval_loss:", trainer.state.best_model_checkpoint)

candidate_path = "qodo-qwen3-1.7b-lora/best-adapter"
trainer.save_model(candidate_path)
tokenizer.save_pretrained(candidate_path)
print(train_result.metrics)
```

راقب:

- هل Train loss تنخفض؟
- هل Validation loss تتحسن أم بدأت ترتفع؟
- هل الـGPU memory ثابتة؟
- هل Checkpoint أعاد Tool JSON صالحًا؟
- هل العربية بقيت طبيعية؟

انخفاض Loss وحده لا يعني نجاح المنتج.

## سابعًا: التقييم قبل الرفع

اعمل جدول نتائج لكل Checkpoint:

| Metric | لماذا تهم؟ |
|---|---|
| Summary coverage | هل التقط القرارات والمسؤولين والمواعيد؟ |
| Hallucination rate | هل أضاف معلومات غير موجودة؟ |
| JSON validity | هل الناتج يمكن للـBackend قراءته؟ |
| Tool selection accuracy | هل اختار Tool الصحيح أم نفذ مكان ما يلخص؟ |
| Required-field accuracy | هل ملأ Assignee وDeadline من الرسالة فقط؟ |
| Clarification rate | هل سأل عند نقص معلومة فعلًا؟ |
| Permission safety | هل رفض التنفيذ غير المسموح؟ |
| p50 / p95 latency | هل التجربة سريعة تحت حمل واقعي؟ |

حالات Qodo الحرجة تشمل:

1. «لخص آخر 20 رسالة» فيلخص العشرين فقط، لا كل تاريخ القناة.
2. رسالة فيها رأي وليست أمرًا، فلا يحولها إلى Task.
3. أمر ناقص Assignee أو Deadline، فيسأل بدل الاختراع.
4. User غير مصرح له، فلا يتم التنفيذ حتى لو نص الرسالة طلبه.
5. نتيجة Tool لا تظهر كأنها كلام حر؛ تكون Structured output يفحصه السيرفر.

اعمل Regression gate: لا يخرج Checkpoint جديد إلى Production لو انخفضت Metric حرجة عن الحد المحدد، حتى لو متوسط النتيجة ارتفع.

### خلية Inference قابلة للتكرار

استخدم Generation settings ثابتة أثناء مقارنة Base وAdapter. المثال التالي يغلق Thinking ويقص Prompt tokens من الناتج:

```python
import torch

def generate_answer(model, tokenizer, messages, max_new_tokens=256):
    inputs = tokenizer.apply_chat_template(
        messages,
        tokenize=True,
        return_dict=True,
        return_tensors="pt",
        add_generation_prompt=True,
        enable_thinking=False,
    ).to(model.device)

    with torch.inference_mode():
        output = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
        )

    generated = output[0, inputs["input_ids"].shape[1]:]
    return tokenizer.decode(generated, skip_special_tokens=True).strip()
```

استخدم نفس الـFunction أولًا على Base model، ثم Base + Adapter المختارة، وسجل الإجابات في ملفين بدل المقارنة بالذاكرة. إعداد `do_sample=False` هنا هدفه Benchmark قابل للتكرار؛ اختبر إعدادات Sampling منفصلة قبل استخدامها في Production.

### مثال Scoring لمهام JSON

افترض أن كل Golden row تحتوي `messages` و`expected_tool` و`required_fields`:

```python
import json

def score_tool_rows(model, tokenizer, rows):
    result = {"count": len(rows), "json_valid": 0,
              "tool_correct": 0, "required_fields_correct": 0}

    for row in rows:
        text = generate_answer(model, tokenizer, row["messages"])
        try:
            payload = json.loads(text)
            result["json_valid"] += 1
        except json.JSONDecodeError:
            continue

        if payload.get("tool") == row["expected_tool"]:
            result["tool_correct"] += 1

        arguments = payload.get("arguments", {})
        if all(arguments.get(name) == value
               for name, value in row["required_fields"].items()):
            result["required_fields_correct"] += 1

    for name in ["json_valid", "tool_correct", "required_fields_correct"]:
        result[name] = result[name] / max(result["count"], 1)
    return result
```

هذا Scorer لا يقيس جودة التلخيص؛ التلخيص يحتاج Rubric مثل: تغطية القرارات، المسؤولين، المواعيد، العوائق، وعدم اختراع معلومة. اجعل لكل Skill Scorer يناسب Contract الخاصة بها.

الترتيب الصحيح للاختبارات:

1. استخدم Validation loss لاختيار Checkpoints مرشحة.
2. استخدم Golden set لاختيار النسخة التي تحقق قواعد المنتج ومنع Regression.
3. بعد تثبيت كل القرارات، شغّل Test set **مرة نهائية** لقياس غير متحيز.
4. شغّل نفس Golden scorers على GGUF عبر `llama.cpp` API قبل Deploy.

## ثامنًا: الملفات التي ستخرج من التدريب

لا تقل «الموديل» وكأنه ملف واحد. عندك ثلاث صور رئيسية:

### 1. LoRA Adapter

ملفات صغيرة مثل:

```text
adapter_config.json
adapter_model.safetensors
tokenizer files
README.md
```

يحتاج Base model عند التشغيل. ممتاز للتخزين والتجارب وتبديل Adapters.

### 2. Merged Model

Base weights بعد دمج تحديث LoRA. حجمه أكبر ويمكن تشغيله كـModel واحدة مع Transformers أو vLLM.

### 3. GGUF

GGUF هي صيغة Container يفهمها `llama.cpp` وOllama، وليست اسم Quantization بعينها؛ يمكن أن تحتوي F16 أو أوزانًا Quantized. نسخة `Q6_K` تحافظ عادة على جودة أعلى من Quantization أصغر، لكنها أكبر وأبطأ من Q4. القرار الحقيقي يأتي من الـEval لا من الاسم.

نظّم Repositories بهذا الشكل:

```text
engosoft/qodo-ai-data-private
engosoft/qodo-ai-qwen3-1.7b-lora
engosoft/qodo-ai-qwen3-1.7b-merged
engosoft/qodo-ai-qwen3-1.7b-gguf
```

الفصل يمنع خلط Adapter حجمه صغير بملف GGUF جاهز للتشغيل.

## تاسعًا: رفع الملفات إلى Hugging Face

### إنشاء Repository ورفع Folder من Python

```python
from huggingface_hub import HfApi

api = HfApi()
repo_id = "engosoft/qodo-ai-qwen3-1.7b-lora"

api.create_repo(
    repo_id=repo_id,
    repo_type="model",
    private=True,
    exist_ok=True,
)

api.upload_folder(
    repo_id=repo_id,
    repo_type="model",
    folder_path="qodo-qwen3-1.7b-lora/best-adapter",
    commit_message="Upload evaluated LoRA adapter v0.3.0",
)
```

الـToken تأتي من Secret في البيئة. لا تكتبها داخل الخلية.

### الرفع من Terminal

```bash
hf auth login
hf repo create engosoft/qodo-ai-qwen3-1.7b-lora --type model --private
hf upload engosoft/qodo-ai-qwen3-1.7b-lora ./best-adapter .
```

قبل الرفع تأكد أن `README.md` يوضح:

- Base model والـRevision.
- هدف الموديل وحدوده.
- Dataset version من غير كشف بيانات خاصة.
- LoRA وTraining config.
- نتائج Golden set قبل وبعد.
- اللغات التي اختبرتها.
- الترخيص المتوافق مع Base model والداتا.
- المخاطر: لا ينفذ Actions من غير Application permissions وConfirmation.

### رفع Dataset

```python
api.create_repo(
    repo_id="engosoft/qodo-ai-data-private",
    repo_type="dataset",
    private=True,
    exist_ok=True,
)
api.upload_folder(
    repo_id="engosoft/qodo-ai-data-private",
    repo_type="dataset",
    folder_path="dataset_release_0.3.0",
)
```

لا تجعل Dataset عامة لمجرد أن الـModel repository عامة.

## عاشرًا: Merge وGGUF

بعد نجاح Adapter، ادمجها مع Base في بيئة عندها RAM وDisk كافيان، ثم احفظ النتيجة بـSafetensors. الفكرة العامة:

```python
import torch
from peft import PeftConfig, PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

adapter_path = "qodo-qwen3-1.7b-lora/best-adapter"
merged_path = "qodo-qwen3-1.7b-merged"

peft_config = PeftConfig.from_pretrained(adapter_path)
base_revision = peft_config.revision

base_model = AutoModelForCausalLM.from_pretrained(
    peft_config.base_model_name_or_path,
    revision=base_revision,
    torch_dtype=torch.float16,
    device_map="auto",
)
model = PeftModel.from_pretrained(
    base_model,
    adapter_path,
)
model = model.merge_and_unload()
model.save_pretrained(merged_path, safe_serialization=True)

tokenizer = AutoTokenizer.from_pretrained(adapter_path)
tokenizer.save_pretrained(merged_path)
```

ثم باستخدام أدوات `llama.cpp` المتوافقة مع Architecture:

```bash
python convert_hf_to_gguf.py ./qodo-qwen3-1.7b-merged \
  --outfile ./qodo-qwen3-1.7b-f16.gguf \
  --outtype f16

llama-quantize \
  ./qodo-qwen3-1.7b-f16.gguf \
  ./qodo-qwen3-1.7b-q6_k.gguf \
  Q6_K
```

أسماء Scripts أو الصيغ المدعومة قد تتغير مع Version `llama.cpp`. سجل Commit المستخدم، ثم أعد Golden tests على ملف GGUF نفسه. نجاح الـMerged model لا يضمن أن النسخة Quantized احتفظت بجودة العربية والـTool routing.

## الحادي عشر: البدائل لـHugging Face

### Kaggle Models وKaggleHub

مفيد لو التدريب يتم في Kaggle وتريد الاحتفاظ بالـModel version هناك. الرفع يتم من خلال KaggleHub بعد إعداد Credentials:

```python
import kagglehub

kagglehub.model_upload(
    "engosoft/qodo-ai/pyTorch/qodo-lora",
    "./best-adapter",
    version_notes="Evaluated adapter v0.3.0",
)
```

راجع Handle المطلوب حاليًا في Kaggle لأن تنسيق الـModel instances والـFrameworks يتطور.

### S3 أو Cloudflare R2 أو Google Cloud Storage

اختيار جيد للملفات الخاصة الكبيرة والتحكم الكامل في الوصول. ستحتاج أنت إلى إدارة:

- Object versioning.
- Checksums.
- Metadata وModel card.
- Signed URLs أو IAM permissions.
- Lifecycle policy للـCheckpoints القديمة.

### GitHub Releases

مناسب للكود وConfigs والملفات الصغيرة، وليس الاختيار الأفضل عادة لWeights كبيرة. لا ترفع Secrets أو Dataset خاصة إلى Git history.

## الثاني عشر: أختار منصة التدريب إزاي؟

| الحالة | البداية المناسبة | الملاحظة |
|---|---|---|
| تجربة تعليمية أو موديل 1–3B بـQLoRA | Colab أو Kaggle Notebook | سهل وسريع، لكن الجلسة والموارد قد تكون محدودة |
| Job يتكرر ويحتاج GPU أقوى | RunPod أو Modal | تحكم أكبر، ادفع مقابل الاستخدام وراقب التخزين |
| بيانات شديدة الحساسية | GPU داخل بيئة الشركة أو Cloud account محكوم | أعلى تحكم، وأعلى مسؤولية تشغيلية |
| تدريب كبير موزع | Managed training أو Cluster متخصص | لا تبدأ هنا قبل إثبات الحاجة والميزانية |

قبل اختيار أي منصة افحص صفحتها الحالية للـGPU والأسعار والحدود؛ هذه التفاصيل تتغير. القرار لا يبنى على كلمة «مجاني» فقط، بل على مدة الجلسة، الـVRAM، حفظ الملفات، وسهولة إعادة التجربة.

## الثالث عشر: النشر على Railway

Railway مناسب كبداية عندما تشغل GGUF صغيرة أو متوسطة من خلال `llama.cpp` server، وعدد الطلبات المتزامنة قليل. المعمارية الآمنة:

```text
Browser
  ↓
Qodo backend: auth + permissions + validation + audit
  ↓
Private AI service on Railway
  ↓
Structured response
  ↓
Qodo backend checks again
  ↓
Preview / confirmation / execution
```

لا تجعل المتصفح يستدعي الموديل مباشرة ولا تعطه Database credentials.

Variables نموذجية على Railway:

```text
MODEL_REPO=engosoft/qodo-ai-qwen3-1.7b-gguf
MODEL_FILE=qodo-qwen3-1.7b-q6_k.gguf
MODEL_SHA256=<sha256-from-the-evaluated-file>
MODEL_DIR=/models
HF_TOKEN=<Railway secret>
AI_INTERNAL_API_KEY=<Railway secret>
MODEL_CONTEXT_SIZE=8192
MODEL_THREADS=<based on allocated CPU>
```

هذه Variables لا تنزل الموديل وحدها. تحتاج Container ينزل الملف ويتحقق منه ثم يشغل `llama-server` على Port التي تعطيها Railway.

### أقل حزمة Deploy مفهومة

ضع `Dockerfile` و`start.sh` في Repository خدمة الـAI. المثال يبدأ من صورة `llama.cpp` الرسمية؛ قبل Production ثبّت Image digest أو Tag اختبرتها بدل الاعتماد على Tag متحركة:

```dockerfile
FROM ghcr.io/ggml-org/llama.cpp:server

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates coreutils \
    && rm -rf /var/lib/apt/lists/*

COPY start.sh /start.sh
RUN chmod +x /start.sh

ENTRYPOINT ["/start.sh"]
```

ملف `start.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

model_dir="${MODEL_DIR:-/models}"
model_path="${model_dir}/${MODEL_FILE}"
mkdir -p "${model_dir}"

if [ ! -s "${model_path}" ]; then
  curl --fail --location --retry 4 \
    --header "Authorization: Bearer ${HF_TOKEN}" \
    "https://huggingface.co/${MODEL_REPO}/resolve/main/${MODEL_FILE}" \
    --output "${model_path}.part"
  mv "${model_path}.part" "${model_path}"
fi

echo "${MODEL_SHA256}  ${model_path}" | sha256sum --check --status

exec /app/llama-server \
  --model "${model_path}" \
  --host 0.0.0.0 \
  --port "${PORT:-8080}" \
  --ctx-size "${MODEL_CONTEXT_SIZE:-8192}" \
  --threads "${MODEL_THREADS:-4}" \
  --reasoning off \
  --api-key "${AI_INTERNAL_API_KEY}"
```

افحص Path الملف التنفيذي داخل Image tag التي ثبتها؛ لو Version غيرته، قد يتغير الـPath أو Flags. إصدارات `llama.cpp` الحالية توفر `--reasoning off`؛ في إصدار أقدم قد تحتاج `--chat-template-kwargs '{"enable_thinking":false}'`. لا تفترض التكافؤ: اختبر الـAPI نفسها وتأكد أن Content لا تحتوي `<think>` وأن Tool JSON ما زالت صالحة. قيمة `MODEL_SHA256` تأتي من **نفس GGUF التي نجحت في Golden tests**، وليس من ملف آخر بالاسم نفسه.

### إعداد Railway خطوة بخطوة

1. اربط Repository خدمة الـAI؛ Railway تكتشف `Dockerfile` الموجودة في الجذر.
2. أضف Variables السابقة كـSecrets، ولا تجعل قيمها Default عامة.
3. أضف Volume على `/models` لو تريد الاحتفاظ بالملف بين Deployments. من غير Volume سيُنزّل الملف عند كل Container جديدة.
4. اضبط Healthcheck path على `/health` وتأكد أن السيرفر يستمع إلى `$PORT` ويرجع HTTP 200 قبل انتهاء مهلة البداية.
5. ضع Qodo backend وخدمة الـAI في نفس Project وEnvironment لو ستستخدم Private Networking، ثم استدعِ اسم الخدمة الداخلي وPort المحددة عبر HTTP.
6. لو Qodo backend خارج هذه البيئة، الـPrivate domain لن تكون متاحة له؛ استخدم Public domain مؤمنة وAPI key وRate limit، أو انقل الـGateway إلى نفس البيئة.
7. اختبر Restart وRedeploy وملف Model غير موجود وChecksum خاطئة. الـDeploy الصحيح يجب أن يفشل مغلقًا عند اختلاف الـChecksum.
8. شغّل Golden scorer على `/v1/chat/completions` المنشورة نفسها، وارفض الإصدار لو عاد Thinking داخل `content` أو اختلف JSON عن نتيجة الملف المحلي.

وجود Volume له Trade-offs: يوفر إعادة التنزيل، لكنه يقيّد Replicas وقد يسبب توقفًا قصيرًا وقت Redeploy. راجع حدود الخطة وحجم GGUF قبل اختيارها.

عند زيادة المستخدمين أو ارتفاع `p95 latency`، انقل Serving إلى GPU وvLLM أو Endpoint متخصص، واترك Railway لتطبيق Qodo أو للـGateway. لا تحاول علاج عدم كفاية CPU بزيادة Timeout فقط.

## الرابع عشر: النشر على منصات أخرى

### RunPod

- Pod ثابت: مناسب للتجارب أو vLLM يعمل باستمرار.
- Serverless endpoint: مناسب للحمل المتقطع، مع الانتباه إلى Cold start وحجم الـModel.

### Modal

مفيد لتعريف Training أو Inference jobs بالكود، وتشغيل GPU عند الحاجة، وفصل Image وVolumes وSecrets عن Notebook الشخصية.

### Replicate

تضع الموديل داخل حزمة تشغيل محددة، غالبًا باستخدام Cog، ثم تحصل على API وإصدارات قابلة للنشر. مناسب لما تريد خدمة Managed بدل إدارة السيرفر بنفسك.

### Hugging Face Inference Endpoints

يسحب Model repository مباشرة ويجهز Endpoint مُدارًا. مريح، لكن احسب تكلفة الـInstance وقارنها بحجم الحمل الحقيقي.

### Hugging Face Spaces

واجهة Demo ممتازة للمراجعة الداخلية أو عرض النموذج، وليست بديلًا تلقائيًا عن Backend إنتاجي فيه Auth وPermissions وAudit.

## الخامس عشر: خطة تنفيذ Qodo بدون لخبطة

نفذ بالترتيب:

1. ثبت Product contract وTool schemas.
2. نظف الداتا الحالية واعمل PII وSecret scan.
3. كبّر Golden set إلى 100–200 حالة تغطي التلخيص والمهام والصلاحيات.
4. نفذ Baseline على Base model من غير Fine-tuning.
5. درب QLoRA صغيرة بتغيير واحد واضح.
6. قارن Base وAdapter على نفس Golden set.
7. ارفع Adapter الخاص مع Model card ونتائج التجربة.
8. ادمج فقط النسخة التي اجتازت الـGate.
9. حوّلها إلى GGUF وأعد الاختبارات.
10. ارفع GGUF في Repository مستقلة.
11. شغل Private AI service على Railway.
12. اربطه بـQodo backend خلف الصلاحيات والتأكيد.
13. راقب الجودة والـLatency، وحوّل أخطاء Production إلى Golden cases مراجعة.
14. انتقل إلى vLLM على GPU فقط عندما تثبت الأرقام أن Railway CPU لم يعد كافيًا.

## Checklist قبل الضغط على Deploy

- [ ] الـToken داخل Secret وليست في الكود أو Git.
- [ ] Base model وRevision والترخيص مسجلون.
- [ ] Dataset version وCounts وSchema مسجلة.
- [ ] لا توجد PII أو محادثات خام أو أسرار.
- [ ] Chat Template اختبرت يدويًا.
- [ ] Trainable parameters مطبوعة ومفهومة.
- [ ] Validation loss وGolden metrics محفوظة.
- [ ] Tool output صالح للـSchema.
- [ ] Permission checks موجودة في الـBackend.
- [ ] Actions الحساسة تحتاج Confirmation.
- [ ] Adapter وMerged وGGUF منفصلون بوضوح.
- [ ] Checksum للملف المنشور محفوظ.
- [ ] GGUF أعيد تقييمها بعد Quantization.
- [ ] p50 وp95 latency مقاسان تحت حمل واقعي.
- [ ] يوجد Rollback إلى الإصدار السابق.

## مراجع رسمية تحدث نفسك منها

- Hugging Face User Access Tokens: <https://huggingface.co/docs/hub/en/security-tokens>
- Hugging Face Upload Files: <https://huggingface.co/docs/huggingface_hub/main/en/guides/upload>
- TRL SFT Trainer: <https://huggingface.co/docs/trl/sft_trainer>
- TRL مع PEFT: <https://huggingface.co/docs/trl/peft_integration>
- llama.cpp: <https://github.com/ggml-org/llama.cpp>
- KaggleHub: <https://github.com/Kaggle/kagglehub>
- Google Colab FAQ: <https://research.google.com/colaboratory/faq.html>
- Kaggle GPU Guide: <https://www.kaggle.com/docs/efficient-gpu-usage>
- RunPod Serverless: <https://docs.runpod.io/serverless/endpoints/overview>
- Modal GPU: <https://modal.com/docs/guide/gpu>
- Replicate Custom Models: <https://replicate.com/docs/get-started/deploy-a-custom-model/>
- Hugging Face Inference Endpoints: <https://huggingface.co/docs/inference-endpoints/quick_start>
- Hugging Face Spaces: <https://huggingface.co/docs/hub/main/spaces-overview>
- Qwen3-1.7B Model Card ووضع Thinking: <https://huggingface.co/Qwen/Qwen3-1.7B>
- Railway Dockerfiles: <https://docs.railway.com/builds/dockerfiles>
- Railway Private Networking: <https://docs.railway.com/private-networking>
- Railway Healthchecks: <https://docs.railway.com/deployments/healthchecks>
- Railway Volumes: <https://docs.railway.com/volumes/reference>

### اختبار الفهم

1. لماذا لا يكفي رفع Adapter وحدها إلى Railway من غير Base model؟
2. ما الفرق بين QLoRA أثناء التدريب وGGUF بعد التدريب؟
3. لماذا نضيف خطأ Production إلى Golden set قبل التفكير في إدخاله إلى Train؟
4. أين يجب أن يتم فحص صلاحية المستخدم قبل إنشاء Task؟
5. ما العلامة التي تقول إن وقت الانتقال من Railway CPU إلى GPU serving قد جاء؟

<div class="chapter-break"></div>

# إجابات اختبارات الفهم

## الفصل 1

1. لا. هو Function تعلمت Parameters من أمثلة.
2. حوالي 1.7 مليار Parameter.
3. Architecture هي التصميم، وCheckpoint هي قيم الأوزان المحفوظة.

## الفصل 2

1. Matrix ثنائية الأبعاد، وTensor اسم عام لأي عدد أبعاد.
2. مقدار واتجاه تأثير كل Weight على Loss.
3. لحساب التأثير عبر سلسلة طويلة من العمليات.

## الفصل 3

1. تصبح الشبكة كلها تحويلًا خطيًا مهما زاد عدد الطبقات.
2. يحرك القرار ولا يجبره على المرور من الصفر.
3. لا، المعرفة موزعة على Parameters كثيرة.

## الفصل 4

```text
Forward => Loss => Backward => Update
```

## الفصل 5

1. لا، قد يكون كلمة أو جزءًا أو Byte.
2. لأن الموديل يعتمد على Special Tokens وترتيب الأدوار الذي تدرب عليه.
3. Tokens أكثر، تكلفة وContext أكبر، وقد تتأثر الجودة.

## الفصل 6

1. لأن قرب IDs لا يمثل قرب المعنى.
2. ليعرف ترتيب Tokens ويفرق بين الجمل ذات الكلمات نفسها بترتيب مختلف.

## الفصل 7

1. Query ما أبحث عنه، Key وصف الموجود، Value المحتوى الذي آخذه.
2. لتثبيت حجم الدرجات قبل Softmax.
3. يرى الإجابة المستقبلية ويغش أثناء التدريب.

## الفصل 8

1. Attention تتبادل المعلومات بين Tokens، وFeed-Forward يعالج كل Token داخليًا.
2. توفر طريقًا للمعلومات والـGradients عبر العمق.
3. لا. هي سياق الطلب الحالي فقط.

## الفصل 9

لأن الموظفين والمهام Facts متغيرة. يجب جلبها وقت الطلب من Database أو Tools، وليس الاعتماد على Weights ثابتة.

## الفصل 11

1. A وB.
2. البعد الصغير الذي يحدد Capacity تحديث LoRA.
3. لا، يحتوي التحديث الصغير وإعداداته.

## الفصل 12

QLoRA تضغط Base أثناء Fine-tuning لتوفير VRAM، أما GGUF Quantization فتضغط الناتج لخدمة Inference.

## الفصل 13

لأن الضغط قد يغير الأوزان ويكسر العربية أو Tool Routing أو الـJSON حتى لو الملف اشتغل.

## الفصل 18

1. لأن Adapter تحتوي التحديث الصغير فقط وتحتاج Architecture وBase weights المطابقة عند التشغيل.
2. QLoRA تضغط Base weights في الذاكرة أثناء تعلم LoRA، أما GGUF فهي صيغة وQuantization لخدمة Inference بعد انتهاء التدريب.
3. حتى يتحول الخطأ فورًا إلى Regression test يقيس الحل، ولا نلوث Train قبل فهم السبب وكتابة الإجابة الصحيحة.
4. في Qodo application server قبل استدعاء التنفيذ، ثم يفحص السيرفر الناتج مرة ثانية؛ كلام الموديل وحده ليس صلاحية.
5. عندما تثبت قياسات الحمل الواقعي أن الـThroughput أو `p95 latency` أو الذاكرة لا تحقق هدف المنتج، بعد استبعاد مشاكل الـPrompt والكود والـContext.

# الخاتمة

لو خرجت من الكتاب بثلاث أفكار، فلتكن:

1. التدريب ليس زرًا. هو Forward وLoss وBackward وUpdate فوق داتا لها Contract واضح.
2. LoRA لا تغير Base Weights؛ تتعلم تحديثًا صغيرًا عبر A وB، وQLoRA تضيف Base مضغوطة أثناء التدريب.
3. الموديل لا يصبح Production بسبب انخفاض Loss. يصبح Production عندما ينجح في Golden Evaluation، ويبقى خلف Permissions وValidation وMonitoring.

الخطوة التالية ليست قراءة فصل جديد. الخطوة التالية هي بناء أصغر `Value` تستطيع عمل Backpropagation، وطباعة الـGradients بيدك. لما تفهم الرقم الصغير، المليار Parameter لن يبقوا سحرًا؛ سيكونون نفس الفكرة متكررة على نطاق ضخم.
