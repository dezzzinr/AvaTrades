"use client";

import Script from "next/script";

// Site-wide Smartsupp live-chat bubble. Renders nothing (no-op) unless
// NEXT_PUBLIC_SMARTSUPP_KEY is configured, so local/dev/preview
// environments without a key don't try to load the widget. Get your key
// from the Smartsupp dashboard: Settings -> Chatbox -> Installation (it's
// the "key" value shown in the embed snippet, a ~24-character hex string).
export default function SmartsuppWidget() {
  const key = process.env.NEXT_PUBLIC_SMARTSUPP_KEY;
  if (!key) return null;

  return (
    <Script id="smartsupp-widget" strategy="afterInteractive">
      {`
        var _smartsupp = _smartsupp || {};
        _smartsupp.key = '${key}';
        window.smartsupp || (function (d) {
          var s, c, o = (window.smartsupp = function () { o._.push(arguments); });
          o._ = [];
          s = d.getElementsByTagName('script')[0];
          c = d.createElement('script');
          c.type = 'text/javascript';
          c.charset = 'utf-8';
          c.async = true;
          c.src = 'https://www.smartsuppchat.com/loader.js?';
          s.parentNode.insertBefore(c, s);
        })(document);
      `}
    </Script>
  );
}
