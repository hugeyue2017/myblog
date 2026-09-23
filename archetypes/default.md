---
title: ''
date: {{ .Date }}
draft: false
# 分享到微信/朋友圈时的缩略图。原图放在 assets/images/ 下，
# 这里写 images/文件名.jpg；不写就用站点默认分享图。
images: ['images/']
---

在这里写正文。段落之间空一行。

照片：把原图（手机导出的即可）放进 assets/images/，
然后用一行 Markdown 引用它：

![一句话说明](images/文件名.jpg)

构建时会自动压缩、抹掉位置信息、生成 WebP 和多档尺寸，不用你处理。

署名（可选，会渲染成衬线体的落款）：

<p class="sig">永远爱你的爸爸（胖虎）妈妈（猪哥）</p>

<p class="sig-date">{{ .Date.Format "2006年1月" }}</p>
