/*
 * Tidy Tabs Panel
 * Adapted from Global Media Controls Panel by Tam710562
 * Integrated with TidyTabs code
 */
(() => {
  'use strict';
  const gnoh = {
    i18n: {
      getMessageName(message, type) {
        message = (type ? type + '\x04' : '') + message;
        return message.replace(/[^a-z0-9]/g, (i) => '_' + i.codePointAt(0) + '_') + '0';
      },
      getMessage(message, type) {
        return chrome.i18n.getMessage(this.getMessageName(message, type)) || message;
      },
    },
    createElement(tagName, attribute, parent, inner, options) {
      if (typeof tagName === 'undefined') {
        return;
      }
      if (typeof options === 'undefined') {
        options = {};
      }
      if (typeof options.isPrepend === 'undefined') {
        options.isPrepend = false;
      }
      const el = document.createElement(tagName);
      if (!!attribute && typeof attribute === 'object') {
        for (const key in attribute) {
          if (key === 'text') {
            el.textContent = attribute[key];
          } else if (key === 'html') {
            el.innerHTML = attribute[key];
          } else if (key === 'style' && typeof attribute[key] === 'object') {
            for (const css in attribute.style) {
              el.style.setProperty(css, attribute.style[css]);
            }
          } else if (key === 'events' && typeof attribute[key] === 'object') {
            for (const event in attribute.events) {
              if (typeof attribute.events[event] === 'function') {
                el.addEventListener(event, attribute.events[event]);
              }
            }
          } else if (typeof el[key] !== 'undefined') {
            el[key] = attribute[key];
          } else {
            if (typeof attribute[key] === 'object') {
              attribute[key] = JSON.stringify(attribute[key]);
            }
            el.setAttribute(key, attribute[key]);
          }
        }
      }
      if (inner) {
        if (!Array.isArray(inner)) {
          inner = [inner];
        }
        for (const element of inner) {
          if (element.nodeName) {
            el.append(element);
          } else {
            el.append(this.createElementFromHTML(element));
          }
        }
      }
      if (typeof parent === 'string') {
        parent = document.querySelector(parent);
      }
      if (parent) {
        if (options.isPrepend) {
          parent.prepend(el);
        } else {
          parent.append(el);
        }
      }
      return el;
    },
    createElementFromHTML(html) {
      return this.createElement('template', {
        html: (html || '').trim(),
      }).content;
    },
    color: {
      rgbToHex(r, g, b) {
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
      },
      rgb2lab(rgb) {
        let r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255, x, y, z;
        r = (r > 0.04045) ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
        g = (g > 0.04045) ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
        b = (b > 0.04045) ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
        x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
        y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
        z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
        x = (x > 0.008856) ? Math.pow(x, 1 / 3) : (7.787 * x) + 16 / 116;
        y = (y > 0.008856) ? Math.pow(y, 1 / 3) : (7.787 * y) + 16 / 116;
        z = (z > 0.008856) ? Math.pow(z, 1 / 3) : (7.787 * z) + 16 / 116;
        return [(116 * y) - 16, 500 * (x - y), 200 * (y - z)]
      },
      deltaE(rgbA, rgbB) {
        const labA = this.rgb2lab(rgbA);
        const labB = this.rgb2lab(rgbB);
        const deltaL = labA[0] - labB[0];
        const deltaA = labA[1] - labB[1];
        const deltaB = labA[2] - labB[2];
        const c1 = Math.sqrt(labA[1] * labA[1] + labA[2] * labA[2]);
        const c2 = Math.sqrt(labB[1] * labB[1] + labB[2] * labB[2]);
        const deltaC = c1 - c2;
        let deltaH = deltaA * deltaA + deltaB * deltaB - deltaC * deltaC;
        deltaH = deltaH < 0 ? 0 : Math.sqrt(deltaH);
        const sc = 1.0 + 0.045 * c1;
        const sh = 1.0 + 0.015 * c1;
        const deltaLKlsl = deltaL / (1.0);
        const deltaCkcsc = deltaC / (sc);
        const deltaHkhsh = deltaH / (sh);
        const i = deltaLKlsl * deltaLKlsl + deltaCkcsc * deltaCkcsc + deltaHkhsh * deltaHkhsh;
        return i < 0 ? 0 : Math.sqrt(i);
      },
      getLuminance(r, g, b) {
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      },
      isLight(r, g, b) {
        return this.getLuminance(r, g, b) < 156;
      },
      shadeColor(r, g, b, percent) {
        const t = percent < 0 ? 0 : 255 * percent;
        const p = percent < 0 ? 1 + percent : 1 - percent;
        return {
          r: Math.round(parseInt(r) * p + t),
          g: Math.round(parseInt(g) * p + t),
          b: Math.round(parseInt(b) * p + t),
        };
      },
    },
    element: {
      appendAtIndex(element, parentElement, index) {
        if (index >= parentElement.children.length) {
          parentElement.append(element)
        } else {
          parentElement.insertBefore(element, parentElement.children[index])
        }
      },
    },
    getReactProps(element) {
      if (typeof element === 'string') {
        element = document.querySelector(element);
      }
      if (!element || element.ownerDocument !== document) {
        return;
      }
      if (!this.reactPropsKey) {
        this.reactPropsKey = Object.keys(element).find((key) => key.startsWith('__reactProps'));
      }
      return element[this.reactPropsKey];
    },
    string: {
      removeDiacritics(str) {
        if (!this._diacriticsMap) {
          const defaultDiacriticsRemovalMap = [
            { 'base': 'A', 'letters': '\u0041\u24B6\uFF21\u00C0\u00C1\u00C2\u1EA6\u1EA4\u1EAA\u1EA8\u00C3\u0100\u0102\u1EB0\u1EAE\u1EB4\u1EB2\u0226\u01E0\u00C4\u01DE\u1EA2\u00C5\u01FA\u01CD\u0200\u0202\u1EA0\u1EAC\u1EB6\u1E00\u0104\u023A\u2C6F' },
            { 'base': 'AA', 'letters': '\uA732' },
            { 'base': 'AE', 'letters': '\u00C6\u01FC\u01E2' },
            { 'base': 'AO', 'letters': '\uA734' },
            { 'base': 'AU', 'letters': '\uA736' },
            { 'base': 'AV', 'letters': '\uA738\uA73A' },
            { 'base': 'AY', 'letters': '\uA73C' },
            { 'base': 'B', 'letters': '\u0042\u24B7\uFF22\u1E02\u1E04\u1E06\u0243\u0182\u0181' },
            { 'base': 'C', 'letters': '\u0043\u24B8\uFF23\u0106\u0108\u010A\u010C\u00C7\u1E08\u0187\u023B\uA73E' },
            { 'base': 'D', 'letters': '\u0044\u24B9\uFF24\u1E0A\u010E\u1E0C\u1E10\u1E12\u1E0E\u0110\u018B\u018A\u0189\uA779\u00D0' },
            { 'base': 'DZ', 'letters': '\u01F1\u01C4' },
            { 'base': 'Dz', 'letters': '\u01F2\u01C5' },
            { 'base': 'E', 'letters': '\u0045\u24BA\uFF25\u00C8\u00C9\u00CA\u1EC0\u1EBE\u1EC4\u1EC2\u1EBC\u0112\u1E14\u1E16\u0114\u0116\u00CB\u1EBA\u011A\u0204\u0206\u1EB8\u1EC6\u0228\u1E1C\u0118\u1E18\u1E1A\u0190\u018E' },
            { 'base': 'F', 'letters': '\u0046\u24BB\uFF26\u1E1E\u0191\uA77B' },
            { 'base': 'G', 'letters': '\u0047\u24BC\uFF27\u01F4\u011C\u1E20\u011E\u0120\u01E6\u0122\u01E4\u0193\uA7A0\uA77D\uA77E' },
            { 'base': 'H', 'letters': '\u0048\u24BD\uFF28\u0124\u1E22\u1E26\u021E\u1E24\u1E28\u1E2A\u0126\u2C67\u2C75\uA78D' },
            { 'base': 'I', 'letters': '\u0049\u24BE\uFF29\u00CC\u00CD\u00CE\u0128\u012A\u012C\u0130\u00CF\u1E2E\u1EC8\u01CF\u0208\u020A\u1ECA\u012E\u1E2C\u0197' },
            { 'base': 'J', 'letters': '\u004A\u24BF\uFF2A\u0134\u0248' },
            { 'base': 'K', 'letters': '\u004B\u24C0\uFF2B\u1E30\u01E8\u1E32\u0136\u1E34\u0198\u2C69\uA740\uA742\uA744\uA7A2' },
            { 'base': 'L', 'letters': '\u004C\u24C1\uFF2C\u013F\u0139\u013D\u1E36\u1E38\u013B\u1E3C\u1E3A\u0141\u023D\u2C62\u2C60\uA748\uA746\uA780' },
            { 'base': 'LJ', 'letters': '\u01C7' },
            { 'base': 'Lj', 'letters': '\u01C8' },
            { 'base': 'M', 'letters': '\u004D\u24C2\uFF2D\u1E3E\u1E40\u1E42\u2C6E\u019C' },
            { 'base': 'N', 'letters': '\u004E\u24C3\uFF2E\u01F8\u0143\u00D1\u1E44\u0147\u1E46\u0145\u1E4A\u1E48\u0220\u019D\uA790\uA7A4' },
            { 'base': 'NJ', 'letters': '\u01CA' },
            { 'base': 'Nj', 'letters': '\u01CB' },
            { 'base': 'O', 'letters': '\u004F\u24C4\uFF2F\u00D2\u00D3\u00D4\u1ED2\u1ED0\u1ED6\u1ED4\u00D5\u1E4C\u022C\u1E4E\u014C\u1E50\u1E52\u014E\u022E\u0230\u00D6\u022A\u1ECE\u0150\u01D1\u020C\u020E\u01A0\u1EDC\u1EDA\u1EE0\u1EDE\u1EE2\u1ECC\u1ED8\u01EA\u01EC\u00D8\u01FE\u0186\u019F\uA74A\uA74C' },
            { 'base': 'OI', 'letters': '\u01A2' },
            { 'base': 'OO', 'letters': '\uA74E' },
            { 'base': 'OU', 'letters': '\u0222' },
            { 'base': 'OE', 'letters': '\u008C\u0152' },
            { 'base': 'oe', 'letters': '\u009C\u0153' },
            { 'base': 'P', 'letters': '\u0050\u24C5\uFF30\u1E54\u1E56\u01A4\u2C63\uA750\uA752\uA754' },
            { 'base': 'Q', 'letters': '\u0051\u24C6\uFF31\uA756\uA758\u024A' },
            { 'base': 'R', 'letters': '\u0052\u24C7\uFF32\u0154\u1E58\u0158\u0210\u0212\u1E5A\u1E5C\u0156\u1E5E\u024C\u2C64\uA75A\uA7A6\uA782' },
            { 'base': 'S', 'letters': '\u0053\u24C8\uFF33\u1E9E\u015A\u1E64\u015C\u1E60\u0160\u1E66\u1E62\u1E68\u0218\u015E\u2C7E\uA7A8\uA784' },
            { 'base': 'T', 'letters': '\u0054\u24C9\uFF34\u1E6A\u0164\u1E6C\u021A\u0162\u1E70\u1E6E\u0166\u01AC\u01AE\u023E\uA786' },
            { 'base': 'TZ', 'letters': '\uA728' },
            { 'base': 'U', 'letters': '\u0055\u24CA\uFF35\u00D9\u00DA\u00DB\u0168\u1E78\u016A\u1E7A\u016C\u00DC\u01DB\u01D7\u01D5\u01D9\u1EE6\u016E\u0170\u01D3\u0214\u0216\u01AF\u1EEA\u1EE8\u1EEE\u1EEC\u1EF0\u1EE4\u1E72\u0172\u1E76\u1E74\u0244' },
            { 'base': 'V', 'letters': '\u0056\u24CB\uFF36\u1E7C\u1E7E\u01B2\uA75E\u0245' },
            { 'base': 'VY', 'letters': '\uA760' },
            { 'base': 'W', 'letters': '\u0057\u24CC\uFF37\u1E80\u1E82\u0174\u1E86\u1E84\u1E88\u2C72' },
            { 'base': 'X', 'letters': '\u0058\u24CD\uFF38\u1E8A\u1E8C' },
            { 'base': 'Y', 'letters': '\u0059\u24CE\uFF39\u1EF2\u00DD\u0176\u1EF8\u0232\u1E8E\u0178\u1EF6\u1EF4\u01B3\u024E\u1EFE' },
            { 'base': 'Z', 'letters': '\u005A\u24CF\uFF3A\u0179\u1E90\u017B\u017D\u1E92\u1E94\u01B5\u0224\u2C7F\u2C6B\uA762' },
            { 'base': 'a', 'letters': '\u0061\u24D0\uFF41\u1E9A\u00E0\u00E1\u00E2\u1EA7\u1EA5\u1EAB\u1EA9\u00E3\u0101\u0103\u1EB1\u1EAF\u1EB5\u1EB3\u0227\u01E1\u00E4\u01DF\u1EA3\u00E5\u01FB\u01CE\u0201\u0203\u1EA1\u1EAD\u1EB7\u1E01\u0105\u2C65\u0250' },
            { 'base': 'aa', 'letters': '\uA733' },
            { 'base': 'ae', 'letters': '\u00E6\u01FD\u01E3' },
            { 'base': 'ao', 'letters': '\uA735' },
            { 'base': 'au', 'letters': '\uA737' },
            { 'base': 'av', 'letters': '\uA739\uA73B' },
            { 'base': 'ay', 'letters': '\uA73D' },
            { 'base': 'b', 'letters': '\u0062\u24D1\uFF42\u1E03\u1E05\u1E07\u0180\u0183\u0253' },
            { 'base': 'c', 'letters': '\u0063\u24D2\uFF43\u0107\u0109\u010B\u010D\u00E7\u1E09\u0188\u023C\uA73F\u2184' },
            { 'base': 'd', 'letters': '\u0064\u24D3\uFF44\u1E0B\u010F\u1E0D\u1E11\u1E13\u1E0F\u0111\u018C\u0256\u0257\uA77A' },
            { 'base': 'dz', 'letters': '\u01F3\u01C6' },
            { 'base': 'e', 'letters': '\u0065\u24D4\uFF45\u00E8\u00E9\u00EA\u1EC1\u1EBF\u1EC5\u1EC3\u1EBD\u0113\u1E15\u1E17\u0115\u0117\u00EB\u1EBB\u011B\u0205\u0207\u1EB9\u1EC7\u0229\u1E1D\u0119\u1E19\u1E1B\u0247\u025B\u01DD' },
            { 'base': 'f', 'letters': '\u0066\u24D5\uFF46\u1E1F\u0192\uA77C' },
            { 'base': 'g', 'letters': '\u0067\u24D6\uFF47\u01F5\u011D\u1E21\u011F\u0121\u01E7\u0123\u01E5\u0260\uA7A1\u1D79\uA77F' },
            { 'base': 'h', 'letters': '\u0068\u24D7\uFF48\u0125\u1E23\u1E27\u021F\u1E25\u1E29\u1E2B\u1E96\u0127\u2C68\u2C76\u0265' },
            { 'base': 'hv', 'letters': '\u0195' },
            { 'base': 'i', 'letters': '\u0069\u24D8\uFF49\u00EC\u00ED\u00EE\u0129\u012B\u012D\u00EF\u1E2F\u1EC9\u01D0\u0209\u020B\u1ECB\u012F\u1E2D\u0268\u0131' },
            { 'base': 'j', 'letters': '\u006A\u24D9\uFF4A\u0135\u01F0\u0249' },
            { 'base': 'k', 'letters': '\u006B\u24DA\uFF4B\u1E31\u01E9\u1E33\u0137\u1E35\u0199\u2C6A\uA741\uA743\uA745\uA7A3' },
            { 'base': 'l', 'letters': '\u006C\u24DB\uFF4C\u0140\u013A\u013E\u1E37\u1E39\u013C\u1E3D\u1E3B\u017F\u0142\u019A\u026B\u2C61\uA749\uA781\uA747' },
            { 'base': 'lj', 'letters': '\u01C9' },
            { 'base': 'm', 'letters': '\u006D\u24DC\uFF4D\u1E3F\u1E41\u1E43\u0271\u026F' },
            { 'base': 'n', 'letters': '\u006E\u24DD\uFF4E\u01F9\u0144\u00F1\u1E45\u0148\u1E47\u0146\u1E4B\u1E49\u019E\u0272\u0149\uA791\uA7A5' },
            { 'base': 'nj', 'letters': '\u01CC' },
            { 'base': 'o', 'letters': '\u006F\u24DE\uFF4F\u00F2\u00F3\u00F4\u1ED3\u1ED1\u1ED7\u1ED5\u00F5\u1E4D\u022D\u1E4F\u014D\u1E51\u1E53\u014F\u022F\u0231\u00F6\u022B\u1ECF\u0151\u01D2\u020D\u020F\u01A1\u1EDD\u1EDB\u1EE1\u1EDF\u1EE3\u1ECD\u1ED9\u01EB\u01ED\u00F8\u01FF\u0254\uA74B\uA74D\u0275' },
            { 'base': 'oi', 'letters': '\u01A3' },
            { 'base': 'ou', 'letters': '\u0223' },
            { 'base': 'oo', 'letters': '\uA74F' },
            { 'base': 'p', 'letters': '\u0070\u24DF\uFF50\u1E55\u1E57\u01A5\u1D7D\uA751\uA753\uA755' },
            { 'base': 'q', 'letters': '\u0071\u24E0\uFF51\u024B\uA757\uA759' },
            { 'base': 'r', 'letters': '\u0072\u24E1\uFF52\u0155\u1E59\u0159\u0211\u0213\u1E5B\u1E5D\u0157\u1E5F\u024D\u027D\uA75B\uA7A7\uA783' },
            { 'base': 's', 'letters': '\u0073\u24E2\uFF53\u00DF\u015B\u1E65\u015D\u1E61\u0161\u1E67\u1E63\u1E69\u0219\u015F\u023F\uA7A9\uA785\u1E9B' },
            { 'base': 't', 'letters': '\u0074\u24E3\uFF54\u1E6B\u1E97\u0165\u1E6D\u021B\u0163\u1E71\u1E6F\u0167\u01AD\u0288\u2C66\uA787' },
            { 'base': 'tz', 'letters': '\uA729' },
            { 'base': 'u', 'letters': '\u0075\u24E4\uFF55\u00F9\u00FA\u00FB\u0169\u1E79\u016B\u1E7B\u016D\u00FC\u01DC\u01D8\u01D6\u01DA\u1EE7\u016F\u0171\u01D4\u0215\u0217\u01B0\u1EEB\u1EE9\u1EEF\u1EED\u1EF1\u1EE5\u1E73\u0173\u1E77\u1E75\u0289' },
            { 'base': 'v', 'letters': '\u0076\u24E5\uFF56\u1E7D\u1E7F\u028B\uA75F\u028C' },
            { 'base': 'vy', 'letters': '\uA761' },
            { 'base': 'w', 'letters': '\u0077\u24E6\uFF57\u1E81\u1E83\u0175\u1E87\u1E85\u1E98\u1E89\u2C73' },
            { 'base': 'x', 'letters': '\u0078\u24E7\uFF58\u1E8B\u1E8D' },
            { 'base': 'y', 'letters': '\u0079\u24E8\uFF59\u1EF3\u00FD\u0177\u1EF9\u0233\u1E8F\u00FF\u1EF7\u1E99\u1EF5\u01B4\u024F\u1EFF' },
            { 'base': 'z', 'letters': '\u007A\u24E9\uFF5A\u017A\u1E91\u017C\u017E\u1E93\u1E95\u01B6\u0225\u0240\u2C6C\uA763' }
          ];
          this._diacriticsMap = {};
          for (const diacritic of defaultDiacriticsRemovalMap) {
            for (const letter of diacritic.letters) {
              this._diacriticsMap[letter] = diacritic.base;
            }
          }
        }
        return str.replace(/[^-\u007E]/g, (a) => {
          return this._diacriticsMap[a] || a;
        });
      },
    },
    addStyle(css, id, isNotMin) {
      this.styles = this.styles || {};
      if (Array.isArray(css)) {
        css = css.join(isNotMin === true ? '\n' : '');
      }
      id = id || this.uuid.generate(Object.keys(this.styles));
      this.styles[id] = this.createElement('style', {
        html: css || '',
        'data-id': id,
      }, document.head);
      return this.styles[id];
    },
    timeOut(callback, condition, timeOut = 300) {
      let timeOutId = setTimeout(function wait() {
        let result;
        if (!condition) {
          result = document.getElementById('browser');
        } else if (typeof condition === 'string') {
          result = document.querySelector(condition);
        } else if (typeof condition === 'function') {
          result = condition();
        } else {
          return;
        }
        if (result) {
          callback(result);
        } else {
          timeOutId = setTimeout(wait, timeOut);
        }
      }, timeOut);
      function stop() {
        if (timeOutId) {
          clearTimeout(timeOutId);
        }
      }
      return {
        stop,
      };
    },
    observeDOM(obj, callback, config) {
      const obs = new MutationObserver((mutations, observer) => {
        if (config || (mutations[0].addedNodes.length || mutations[0].removedNodes.length)) {
          callback(mutations, observer);
        }
      });
      obs.observe(obj, config || {
        childList: true,
        subtree: true,
      });
    },
    uuid: {
      generate(ids) {
        let d = Date.now() + performance.now();
        let r;
        const id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          r = (d + Math.random() * 16) % 16 | 0;
          d = Math.floor(d / 16);
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
        if (Array.isArray(ids) && ids.includes(id)) {
          return this.generate(ids);
        }
        return id;
      },
    },
  };
  // ==================== TidyTabs Code (Modified) ====================
  // ==================== Configuration ====================
  const CONFIG = {
    ai: {
      provider: 'openai', // 'openai', 'ollama'
      openai: {
        url: '',
        key: '',
        model: ''
      },
      ollama: {
        url: 'http://localhost:11434/api/chat',
        model: 'llama3'
      },
      promptType: 'smart_grouper', 
      includeExistingStacks: true,
      customInstructions: '',
      temperature: 0.3,
      maxTokens: 2048
    },
    // Auto-stack enabled workspaces (empty array = disabled for all)
    autoStackWorkspaces: [],
    // Feature toggles
    enableAIGrouping: true,
    maxTabsForAI: 50,
    // Delays
    delays: {
      init: 500,
      mutation: 50,
      workspaceSwitch: 100,
      retry: 500,
      reattach: 500,
      debounce: 150,
      autoStack: 1000
    }
  };

  const PROMPT_TEMPLATES = {
    simple: `You are an AI assistant helping categorize browser tabs.

Here are the open tabs:

{tabList}

Group these {tabCount} tabs into logical categories.`,
    
    smart_grouper: `As an AI assistant, analyze and organize these {tabCount} browser tabs into meaningful groups. Here are open tabs: 

{tabList}

Follow these specific guidelines:
1. Create intuitive groups that reflect how users naturally organize their work and activities
2. Use short, clear category names (1-2 words) that instantly convey the purpose
3. Consider tab relationships based on:
   - Common domains or platforms
   - Related topics or projects
   - Similar purposes (research, shopping, etc.)
   - Temporal context (current tasks vs reference material)
4. Rules:
- Create 3-8 groups based on tab count and content similarity
- not to make too many groups
- Use short, clear category names (1-2 words, try just 1 word)
- Keep groups focused and cohesive
- Each tab must be assigned to exactly one group
- Group related items even if from different domains`,

    context_aware: `Analyze the provided list of tab data and assign a concise category (1-2 words, Title Case) for EACH tab.

Existing Categories:
{existingGroups}
---
Instructions for Assignment:
1.  **Prioritize Existing:** For each tab below, determine if it clearly belongs to one of the 'Existing Categories'. Base this primarily on the URL/Domain, then Title/Description. If it fits, you MUST use the EXACT category name provided in the 'Existing Categories' list. DO NOT create a minor variation (e.g., if 'Project Docs' exists, use that, don't create 'Project Documentation').
2.  **Assign New Category (If Necessary):** Only if a tab DOES NOT fit an existing category, assign the best NEW concise category (1-2 words, Title Case).
4.  **Format:** 1-2 words, Title Case.
---
Input Tab Data:
{tabList}`
  };

  const getFormatInstructions = (languageName, othersName) => `

**CRITICAL REQUIREMENTS:**
1. **All group names must use ${languageName} language**
2. Tabs that cannot be grouped with any other tabs should be added to the "Others" stack (${othersName})

**OUTPUT FORMAT:**
Output **strictly valid JSON format only**, nothing else:
Avoid the following:
* Empty elements (e.g. [5, , 7])
* Missing quotes or commas
* tab_ids containing only single tab groups (e.g. "tab_ids": [6])
* ***No additional explanatory text, comments, or extra content in output***

**Output example (must strictly follow):**
{ "groups": [ { "name": "Group name", "tab_ids": [0, 1, 2] }, { "name": "Group name 2", "tab_ids": [3, 4] }, { "name": "${othersName}", "tab_ids": [5, 6] } ] }
`;

  // Selectors
  const SELECTORS = {
    TAB_STRIP: '.tab-strip',
    SEPARATOR: '.tab-strip .separator',
    TAB_WRAPPER: '.tab-wrapper',
    TAB_POSITION: '.tab-position',
    STACK_COUNTER: '.stack-counter',
    TAB_STACK: '.svg-tab-stack',
    SUBSTACK: '.tab-position.is-substack, .tab-position.is-stack'
  };
  const CLASSES = {
    BUTTON: 'tidy-tabs-below-button',
    LOADING: 'tidy-loading-icon',
    PINNED: 'is-pinned'
  };
  // Language mappings
  const LANGUAGE_MAP = {
    'zh': '中文',
    'zh-CN': '中文',
    'zh-TW': '中文',
    'en': 'English',
    'en-US': 'English',
    'en-GB': 'English',
    'ja': '日本語',
    'ja-JP': '日本語',
    'ko': '한국어',
    'ko-KR': '한국어',
    'es': 'Español',
    'fr': 'Français',
    'de': 'Deutsch',
    'ru': 'Русский',
    'pt': 'Português',
    'it': 'Italiano',
    'ar': 'العربية',
    'hi': 'हिन्दी'
  };
  const OTHERS_NAMES = ['其它', 'Others', 'その他', 'Other', 'Outros', 'Andere', 'Autres'];
  // Debounce timer
  let debounceTimer = null;
  // ==================== Utility Functions ====================
  // Get browser UI language
  const getBrowserLanguage = () => {
    return chrome.i18n.getUILanguage() || navigator.language || 'zh-CN';
  };
  // Convert language code to natural language name
  const getLanguageName = (langCode) => {
    if (LANGUAGE_MAP[langCode]) return LANGUAGE_MAP[langCode];
    const mainLang = langCode.split('-')[0];
    return LANGUAGE_MAP[mainLang] || 'English';
  };
  // Get "Others" group name in current language
  const getOthersName = () => {
    const langName = getLanguageName(getBrowserLanguage());
    const mapping = {
      '中文': '其它',
      'English': 'Others',
      '日本語': 'その他'
    };
    return mapping[langName] || 'Others';
  };
  // Get URL fragments using Vivaldi API or fallback
  const getUrlFragments = (url) => {
    try {
      if (typeof vivaldi !== 'undefined' && vivaldi.utilities?.getUrlFragments) {
        return vivaldi.utilities.getUrlFragments(url);
      }
    } catch (e) {
      // Fallback
    }
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const parts = hostname.split('.');
      const tld = parts.length > 1 ? parts[parts.length - 1] : '';
      return {
        hostForSecurityDisplay: hostname,
        tld: tld
      };
    } catch (e) {
      return {
        hostForSecurityDisplay: '',
        tld: ''
      };
    }
  };
  // Get base domain from URL
  const getBaseDomain = (url) => {
    const { hostForSecurityDisplay, tld } = getUrlFragments(url);
    const match = hostForSecurityDisplay.match(`([^.]+\\.${tld})$`);
    return match ? match[1] : hostForSecurityDisplay;
  };
  // Get hostname from URL
  const getHostname = (url) => {
    const { hostForSecurityDisplay } = getUrlFragments(url);
    return hostForSecurityDisplay;
  };
  // Get tab details by ID
  const getTab = async (tabId) => {
    return new Promise((resolve) => {
      chrome.tabs.get(tabId, function (tab) {
        if (chrome.runtime.lastError) {
          console.error('Error getting tab:', chrome.runtime.lastError);
          resolve(null);
          return;
        }
        if (tab.vivExtData) {
          try {
            tab.vivExtData = JSON.parse(tab.vivExtData);
          } catch (e) {
            console.error('Error parsing vivExtData:', e);
          }
        }
        resolve(tab);
      });
    });
  };
  // Get workspace name by ID
  const getWorkspaceName = async (workspaceId) => {
    if (!workspaceId) {
      return '<default_workspace>';
    }
    return new Promise((resolve) => {
      if (typeof vivaldi !== 'undefined' && vivaldi.prefs) {
        vivaldi.prefs.get('vivaldi.workspaces.list', (workspaceList) => {
          const workspace = workspaceList.find(item => item.id === workspaceId);
          resolve(workspace ? workspace.name : '<unknown_workspace>');
        });
      } else {
        resolve('<unknown_workspace>');
      }
    });
  };
  // Get all workspaces
  const getAllWorkspaces = async () => {
    return new Promise((resolve) => {
      if (typeof vivaldi !== 'undefined' && vivaldi.prefs) {
        vivaldi.prefs.get('vivaldi.workspaces.list', (workspaceList) => {
          resolve(workspaceList);
        });
      } else {
        resolve([]);
      }
    });
  };
  // Check if workspace allows auto-stacking
  const isAutoStackAllowed = async (workspaceId) => {
    if (CONFIG.autoStackWorkspaces.length === 0) {
      return false;
    }
    const workspaceName = await getWorkspaceName(workspaceId);
    return CONFIG.autoStackWorkspaces.includes(workspaceName);
  };
  // Get all tabs in specified workspace
  const getTabsByWorkspace = async (workspaceId) => {
    return new Promise((resolve) => {
      chrome.tabs.query({ currentWindow: true }, async function (tabs) {
        if (chrome.runtime.lastError) {
          console.error('Error querying tabs:', chrome.runtime.lastError);
          resolve([]);
          return;
        }
        const validTabs = [];
        for (const tab of tabs) {
          if (tab.id === -1 || !tab.vivExtData) continue;
          try {
            const vivExtData = JSON.parse(tab.vivExtData);
            if (vivExtData.workspaceId === workspaceId) {
              if (!tab.pinned && !vivExtData.panelId) {
                validTabs.push({ ...tab, vivExtData: vivExtData });
              }
            }
          } catch (e) {
            console.error('Error parsing vivExtData:', e);
          }
        }
        resolve(validTabs);
      });
    });
  };
  // Add tab to stack
  const addTabToStack = async (tabId, stackId, stackName) => {
    const tab = await getTab(tabId);
    if (!tab || !tab.vivExtData) {
      console.warn('Tab has no vivExtData:', tabId);
      return;
    }
    const vivExtData = tab.vivExtData;
    if (stackName) {
      vivExtData.fixedGroupTitle = stackName;
    }
    vivExtData.group = stackId;
    return new Promise((resolve) => {
      chrome.tabs.update(tabId, { vivExtData: JSON.stringify(vivExtData) }, function () {
        if (chrome.runtime.lastError) {
          console.error('Error updating tab:', chrome.runtime.lastError);
        } else {
          console.log(`Added tab ${tabId} to stack ${stackId} (${stackName})`);
        }
        resolve();
      });
    });
  };
  // Show notification
  const showNotification = (message, type = 'error') => {
    if (typeof chrome !== 'undefined' && chrome.notifications) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><text y="32" font-size="32">⚠️</text></svg>',
        title: 'TidyTabs',
        message: message,
        priority: type === 'error' ? 2 : 1
      });
    } else {
      console.error(`[TidyTabs] ${message}`);
      alert(`TidyTabs: ${message}`);
    }
  };
  // ==================== AI Grouping ====================
  // Build AI prompt for tab grouping
  const buildAIPrompt = (tabs, existingStacks, languageName) => {
    const tabsInfoText = tabs.map((tab, index) => `${index}. ${tab.title || 'Untitled'} (${getHostname(tab.url)})`).join('\n');
    let existingInfoText = "None";
    if (CONFIG.ai.includeExistingStacks && Array.isArray(existingStacks) && existingStacks.length > 0) {
      existingInfoText = existingStacks.map(s => s.name || 'Unnamed stack').join('\n');
    }
    const othersName = getOthersName();
    
    let basePrompt = PROMPT_TEMPLATES[CONFIG.ai.promptType] || PROMPT_TEMPLATES.smart_grouper;
    basePrompt = basePrompt.replace('{tabList}', tabsInfoText)
                           .replace('{tabCount}', tabs.length.toString())
                           .replace('{existingGroups}', existingInfoText);
    
    if (CONFIG.ai.customInstructions && CONFIG.ai.customInstructions.trim() !== '') {
      basePrompt += `\n\n**Custom Instructions:**\n${CONFIG.ai.customInstructions.trim()}\n`;
    }

    basePrompt += getFormatInstructions(languageName, othersName);
    return basePrompt;
  };
  // Parse and validate AI response
  const parseAIResponse = (content) => {
    let jsonStr = content.trim();
    // Remove possible markdown code block markers
    const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }
    // Extract JSON from surrounding text
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }
    console.log('Extracted JSON string:', jsonStr);
    try {
      return JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      console.error('Failed JSON string:', jsonStr);
      showNotification('AI returned invalid data format, cannot parse JSON. Check console for details.');
      return null;
    }
  };
  // Validate AI grouping result
  const validateAIGroups = (result) => {
    if (!result.groups || !Array.isArray(result.groups)) {
      console.error('Invalid response format: missing or invalid groups array');
      showNotification('AI returned incorrect data format: missing groups array');
      return false;
    }
    for (const group of result.groups) {
      if (!group.name || typeof group.name !== 'string') {
        console.error('Invalid group: missing or invalid name', group);
        showNotification('AI returned group missing valid name');
        return false;
      }
      if (!Array.isArray(group.tab_ids)) {
        console.error('Invalid group: tab_ids is not an array', group);
        showNotification('AI returned group where tab_ids is not an array');
        return false;
      }
      // Check for single-tab groups (excluding "Others")
      if (group.tab_ids.length === 1 && !OTHERS_NAMES.includes(group.name)) {
        console.warn('Warning: Group has only one tab:', group);
      }
    }
    return true;
  };
  // Map AI results to internal format
  const mapAIResultsToGroups = (aiResult, tabs, existingStacks) => {
    const initialGroups = aiResult.groups.map(group => {
      const existingStack = existingStacks.find(s => s.name === group.name);
      return {
        name: group.name,
        tabs: group.tab_ids.map(id => tabs[id]).filter(t => t),
        stackId: existingStack ? existingStack.id : crypto.randomUUID(),
        isExisting: !!existingStack
      };
    });
    // Apply smart filtering rules
    const filteredGroups = initialGroups.filter(group => {
      // Rule 1: Keep existing stacks even with single tab
      if (group.isExisting) return true;
      // Rule 2: New stacks must have at least 2 tabs
      return group.tabs.length > 1;
    });
    console.log('AI grouping result after smart filtering:', filteredGroups);
    return filteredGroups;
  };
  // Handle orphan tabs (tabs not in any group)
  const handleOrphanTabs = (groupedTabs, tabs, existingStacks, languageName) => {
    const groupedTabIds = new Set();
    groupedTabs.forEach(group => {
      group.tabs.forEach(tab => groupedTabIds.add(tab.id));
    });
    const orphanTabs = tabs.filter(tab => !groupedTabIds.has(tab.id));
    if (orphanTabs.length === 0) {
      console.log('No orphan tabs found, all tabs are grouped');
      return;
    }
    console.log(`Found ${orphanTabs.length} orphan tabs:`, orphanTabs.map(t => t.title));
    // Check if "Others" group exists in AI results
    let othersGroup = groupedTabs.find(g => OTHERS_NAMES.includes(g.name));
    if (othersGroup) {
      // Case A: AI successfully created a multi-tab "Others" group
      console.log('Adding orphan tabs to existing "Others" group from AI result');
      othersGroup.tabs.push(...orphanTabs);
    } else {
      // Case B: Check original existing stacks for "Others"
      const existingOthersStack = existingStacks.find(s => OTHERS_NAMES.includes(s.name));
      if (existingOthersStack) {
        console.log('Adding orphan tabs to EXISTING "Others" stack from original list');
        groupedTabs.push({
          name: existingOthersStack.name,
          tabs: orphanTabs,
          stackId: existingOthersStack.id,
          isExisting: true
        });
      } else if (orphanTabs.length > 1) {
        // No "Others" found and multiple orphans, create new
        const othersName = getOthersName();
        console.log(`Creating new "Others" group with ${orphanTabs.length} tabs`);
        groupedTabs.push({
          name: othersName,
          tabs: orphanTabs,
          stackId: crypto.randomUUID(),
          isExisting: false
        });
      } else {
        // Only 1 orphan and no "Others" stack, don't create
        console.log('Only 1 orphan tab found and no "Others" stack, not creating group');
      }
    }
  };
  // Call AI API for intelligent grouping
  const getAIGrouping = async (tabs, existingStacks = []) => {
    if (CONFIG.ai.provider === 'openai' && (!CONFIG.ai.openai.url || !CONFIG.ai.openai.key)) {
      console.error('OpenAI API URL or Key not configured');
      showNotification('OpenAI API URL or Key not configured, cannot use AI grouping');
      return null;
    }
    if (CONFIG.ai.provider === 'ollama' && !CONFIG.ai.ollama.url) {
      console.error('Ollama API URL not configured');
      showNotification('Ollama API URL not configured, cannot use AI grouping');
      return null;
    }

    if (tabs.length > CONFIG.maxTabsForAI) {
      console.warn(`Too many tabs (${tabs.length}), limiting to ${CONFIG.maxTabsForAI}`);
      tabs = tabs.slice(0, CONFIG.maxTabsForAI);
    }
    const browserLang = getBrowserLanguage();
    const languageName = getLanguageName(browserLang);
    console.log(`Browser language: ${browserLang} (${languageName})`);
    const prompt = buildAIPrompt(tabs, existingStacks, languageName);
    
    try {
      console.log('Calling AI API for intelligent grouping...');
      let content = '';

      if (CONFIG.ai.provider === 'openai') {
        const response = await fetch(CONFIG.ai.openai.url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${CONFIG.ai.openai.key}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: CONFIG.ai.openai.model,
            messages: [{
              role: 'user',
              content: prompt
            }],
            temperature: CONFIG.ai.temperature,
            max_tokens: CONFIG.ai.maxTokens,
            stream: false
          })
        });
        if (!response.ok) {
          throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        content = data.choices[0].message.content;
      } else if (CONFIG.ai.provider === 'ollama') {
        const urlToUse = CONFIG.ai.ollama.url.trim();
        if (urlToUse.includes('/api/generate')) {
          const response = await fetch(urlToUse, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: CONFIG.ai.ollama.model,
              prompt: prompt,
              stream: false,
              format: 'json'
            })
          });
          if (!response.ok) throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
          const data = await response.json();
          content = data.response;
        } else {
          const chatUrl = urlToUse.endsWith('/api/chat') ? urlToUse : urlToUse.replace(/\/$/, '') + '/api/chat';
          const response = await fetch(chatUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: CONFIG.ai.ollama.model,
              messages: [{
                role: 'user',
                content: prompt
              }],
              stream: false,
              format: 'json'
            })
          });
          if (!response.ok) throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
          const data = await response.json();
          content = data.message.content;
        }
      }

      console.log('AI API content:', content);
      const result = parseAIResponse(content);
      if (!result) return null;
      if (!validateAIGroups(result)) return null;
      const groupedTabs = mapAIResultsToGroups(result, tabs, existingStacks);
      handleOrphanTabs(groupedTabs, tabs, existingStacks, languageName);
      console.log('AI grouping result (final):', groupedTabs);
      if (groupedTabs.length === 0) {
        console.warn('No valid groups created (all groups have less than 2 tabs)');
        showNotification('AI grouping failed: all groups have less than 2 tabs');
        return null;
      }
      return groupedTabs;
    } catch (error) {
      console.error('Error calling AI API:', error);
      showNotification(`Error calling AI API: ${error.message}`);
      return null;
    }
  };
  // Group by domain (fallback method)
  const groupByDomain = (tabs) => {
    const tabsByHost = {};
    tabs.forEach(tab => {
      const hostname = getHostname(tab.url);
      if (!tabsByHost[hostname]) {
        tabsByHost[hostname] = [];
      }
      tabsByHost[hostname].push(tab);
    });
    // Only return groups with multiple tabs
    return Object.entries(tabsByHost)
      .filter(([_, tabs]) => tabs.length > 1)
      .map(([hostname, tabs]) => {
        const baseDomain = getBaseDomain(tabs[0].url).split('.')[0];
        const name = baseDomain.charAt(0).toUpperCase() + baseDomain.slice(1);
        return {
          name: name,
          tabs: tabs,
          stackId: crypto.randomUUID(),
          isExisting: false
        };
      });
  };
  // ==================== Tab Stack Operations ====================
  // Create tab stacks from groups
  const createTabStacks = async (groups) => {
    for (const group of groups) {
      const stackId = group.stackId || crypto.randomUUID();
      const stackName = group.name;
      console.log(`${group.isExisting ? 'Adding to existing' : 'Creating'} stack "${stackName}" with ${group.tabs.length} tabs`);
      // Sort by index
      group.tabs.sort((a, b) => a.index - b.index);
      // Use first tab's position as target
      const targetIndex = group.tabs[0].index;
      // Move all tabs to adjacent positions and add to stack
      for (let i = 0; i < group.tabs.length; i++) {
        const tab = group.tabs[i];
        const moveIndex = targetIndex + i;
        // Move tab first
        await new Promise((resolve) => {
          chrome.tabs.move(tab.id, { index: moveIndex }, function () {
            if (chrome.runtime.lastError) {
              console.error('Error moving tab:', chrome.runtime.lastError);
            }
            resolve();
          });
        });
        // Then add to stack
        await addTabToStack(tab.id, stackId, stackName);
      }
    }
  };
  // Detect existing stacks from DOM
  const detectExistingStacks = async (nextElement) => {
    const existingStacks = [];
    while (nextElement) {
      if (nextElement.tagName !== 'SPAN') {
        nextElement = nextElement.nextElementSibling;
        continue;
      }
      const isStack = nextElement.querySelector(SELECTORS.STACK_COUNTER) !== null ||
        nextElement.querySelector(SELECTORS.TAB_STACK) !== null ||
        nextElement.querySelector(SELECTORS.SUBSTACK) !== null;
      if (isStack) {
        console.log('Found existing tab stack DOM:', nextElement.outerHTML.slice(0, 200));
        const stackWrapper = nextElement.querySelector(SELECTORS.TAB_WRAPPER);
        const stackTabId = stackWrapper?.getAttribute('data-id')?.replace('tab-', '');
        if (stackTabId) {
          const allTabs = await new Promise(resolve => {
            chrome.tabs.query({ currentWindow: true }, tabs => resolve(tabs));
          });
          const stackTab = allTabs.find(t => {
            try {
              const data = JSON.parse(t.vivExtData || '{}');
              return data && data.group && t.vivExtData.includes(stackTabId.slice(0, 8));
            } catch {
              return false;
            }
          });
          if (stackTab) {
            const viv = JSON.parse(stackTab.vivExtData);
            existingStacks.push({
              id: viv.group,
              name: viv.fixedGroupTitle || stackTab.title || 'Unnamed stack',
              tabId: stackTab.id
            });
            console.log(`Detected existing stack: ${viv.fixedGroupTitle || stackTab.title} (ID: ${viv.group})`);
          } else {
            console.warn('No matching chrome tab found for DOM id:', stackTabId);
          }
        }
      }
      nextElement = nextElement.nextElementSibling;
    }
    return existingStacks;
  };
  // Collect tabs from separator onwards
  const collectTabsFromSeparator = (separator) => {
    const tabsInfo = [];
    let nextElement = separator.nextElementSibling;
    while (nextElement) {
      if (nextElement.tagName === 'SPAN') {
        const tabWrapper = nextElement.querySelector(SELECTORS.TAB_WRAPPER);
        const tabPosition = nextElement.querySelector(SELECTORS.TAB_POSITION);
        const isStack = nextElement.querySelector(SELECTORS.STACK_COUNTER) !== null ||
          nextElement.querySelector(SELECTORS.TAB_STACK) !== null ||
          nextElement.querySelector(SELECTORS.SUBSTACK) !== null;
        // Skip stacks, collect unpinned tabs
        if (!isStack && tabPosition && !tabPosition.classList.contains(CLASSES.PINNED)) {
          const tabId = tabWrapper?.getAttribute('data-id');
          if (tabId) {
            const numericId = parseInt(tabId.replace('tab-', ''));
            if (!isNaN(numericId)) {
              tabsInfo.push({ id: numericId });
            }
          }
        }
      }
      nextElement = nextElement.nextElementSibling;
    }
    return tabsInfo;
  };
  // ==================== UI Components ====================
  // Create Tidy button
  const createTidyButton = () => {
    const button = document.createElement('div');
    button.className = CLASSES.BUTTON;
    button.textContent = 'Tidy';
    return button;
  };
  // Create loading icon
  const createLoadingIcon = () => {
    const container = document.createElement('div');
    container.className = CLASSES.LOADING;
    container.innerHTML = `<svg width="28" height="28" style="padding:8px" fill="hsl(228, 97%, 42%)" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="RadialGradient8932"><stop offset="0%" stop-color="currentColor"/><stop offset="100%" stop-color="currentColor" stop-opacity=".25"/></linearGradient></defs><style>@keyframes spin8932{to{transform:rotate(360deg)}}</style><circle cx="10" cy="10" r="8" stroke-width="2" style="transform-origin:50% 50%;stroke:url(#RadialGradient8932);fill:none;animation:spin8932 .5s infinite linear"/></svg>`;
    return container;
  };
  // Show loading state
  const showLoading = (separator) => {
    if (separator.querySelector(`.${CLASSES.LOADING}`)) return;
    const loadingIcon = createLoadingIcon();
    separator.appendChild(loadingIcon);
  };
  // Hide loading state
  const hideLoading = (separator) => {
    const loadingIcon = separator.querySelector(`.${CLASSES.LOADING}`);
    if (loadingIcon) {
      loadingIcon.remove();
    }
  };
  // Debounced button attachment
  const scheduleAttachButtons = (delay = CONFIG.delays.debounce) => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      attachButtons();
      debounceTimer = null;
    }, delay);
  };
  // Attach Tidy buttons to all separators
  const attachButtons = () => {
    const separators = document.querySelectorAll(SELECTORS.SEPARATOR);
    separators.forEach(separator => {
      if (separator.querySelector(`.${CLASSES.BUTTON}`)) {
        return;
      }
      const button = createTidyButton();
      separator.appendChild(button);
      button.addEventListener('click', function (e) {
        e.stopPropagation();
        tidyTabsBelow(separator);
      });
    });
  };
  // ==================== Core Functionality ====================
  // Auto-stack workspace tabs
  const autoStackWorkspace = async (workspaceId) => {
    const allowed = await isAutoStackAllowed(workspaceId);
    if (!allowed) return;
    const workspaceName = await getWorkspaceName(workspaceId);
    console.log(`Auto-stacking workspace: ${workspaceName}`);
    const tabs = await getTabsByWorkspace(workspaceId);
    if (tabs.length < 2) {
      console.log('Not enough tabs in workspace');
      return;
    }
    let groups;
    if (CONFIG.enableAIGrouping) {
      groups = await getAIGrouping(tabs);
      if (!groups) {
        console.log('AI grouping failed, falling back to domain grouping');
        groups = groupByDomain(tabs);
      }
    } else {
      groups = groupByDomain(tabs);
    }
    if (groups.length === 0) {
      console.log('No groups to create');
      return;
    }
    await createTabStacks(groups);
    console.log('Auto-stacking completed!');
  };
  // Tidy current workspace (for panel button)
  const tidyCurrentWorkspace = async () => {
    const currentTab = await new Promise(resolve => chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0])));
    if (!currentTab) return;
    let vivExtData;
    try {
      vivExtData = JSON.parse(currentTab.vivExtData);
    } catch {
      return;
    }
    const workspaceId = vivExtData.workspaceId;
    const tabs = await getTabsByWorkspace(workspaceId);
    if (tabs.length < 2) {
      showNotification('Not enough tabs in current workspace to tidy.');
      return;
    }
    const groupMap = {};
    tabs.forEach(tab => {
      if (tab.vivExtData.group) {
        const groupId = tab.vivExtData.group;
        if (!groupMap[groupId]) {
          groupMap[groupId] = {
            id: groupId,
            name: tab.vivExtData.fixedGroupTitle || '',
            tabs: []
          };
        }
        groupMap[groupId].tabs.push(tab);
      }
    });
    const existingStacks = Object.values(groupMap).map(g => ({
      id: g.id,
      name: g.name
    }));
    const ungroupedTabs = tabs.filter(tab => !tab.vivExtData.group);
    if (ungroupedTabs.length < 2) {
      showNotification('Not enough ungrouped tabs to tidy.');
      return;
    }
    let groups;
    if (CONFIG.enableAIGrouping) {
      console.log('Using AI grouping for current workspace...');
      groups = await getAIGrouping(ungroupedTabs, existingStacks);
      if (!groups) {
        console.log('AI grouping failed, falling back to domain grouping');
        groups = groupByDomain(ungroupedTabs);
      }
    } else {
      console.log('Using domain grouping for current workspace...');
      groups = groupByDomain(ungroupedTabs);
    }
    if (groups.length === 0) {
      showNotification('No groups to create in current workspace.');
      return;
    }
    await createTabStacks(groups);
    console.log('Current workspace tidied!');
    showNotification('Current workspace has been tidied!', 'info');
  };
  // Manually tidy tabs below separator
  const tidyTabsBelow = async (separator) => {
    const existingStacks = await detectExistingStacks(separator.nextElementSibling);
    const tabsInfo = collectTabsFromSeparator(separator);
    console.log('Tabs found:', tabsInfo.length);
    console.log('Existing stacks found:', existingStacks.length);
    if (tabsInfo.length < 2 && existingStacks.length === 0) {
      console.log('Not enough tabs to group (need at least 2) and no existing stacks');
      return;
    }
    showLoading(separator);
    try {
      const tabs = await Promise.all(tabsInfo.map(info => getTab(info.id)));
      const validTabs = tabs.filter(t => t !== null);
      console.log('Valid tabs:', validTabs.length);
      if (validTabs.length < 1 && existingStacks.length === 0) {
        console.log('No valid tabs or existing stacks');
        return;
      }
      let groups;
      if (CONFIG.enableAIGrouping) {
        console.log('Using AI grouping...');
        groups = await getAIGrouping(validTabs, existingStacks);
        if (!groups) {
          console.log('AI grouping failed, falling back to domain grouping');
          groups = groupByDomain(validTabs);
        }
      } else {
        console.log('Using domain grouping...');
        groups = groupByDomain(validTabs);
      }
      if (groups.length === 0) {
        console.log('No groups to create');
        return;
      }
      await createTabStacks(groups);
      console.log('Tab stacking completed!');
    } finally {
      hideLoading(separator);
      scheduleAttachButtons(CONFIG.delays.reattach);
    }
  };
  // ==================== Event Listeners ====================
  // Setup auto-stacking listener
  const setupAutoStackListener = () => {
    if (!chrome.webNavigation) return;
    chrome.webNavigation.onCommitted.addListener(async (details) => {
      if (details.tabId !== -1 && details.frameType === 'outermost_frame') {
        const tab = await getTab(details.tabId);
        if (tab && !tab.pinned && tab.vivExtData && !tab.vivExtData.panelId) {
          const workspaceId = tab.vivExtData.workspaceId;
          setTimeout(() => {
            autoStackWorkspace(workspaceId);
          }, CONFIG.delays.autoStack);
        }
      }
    });
    console.log('Auto-stacking listener registered');
  };
  // Setup mutation observer for tab strip changes
  const observeTabStrip = () => {
    const tabStrip = document.querySelector(SELECTORS.TAB_STRIP);
    if (!tabStrip) {
      setTimeout(observeTabStrip, CONFIG.delays.retry);
      return;
    }
    const observer = new MutationObserver(function (mutations) {
      let hasTabChange = false;
      let hasWorkspaceSwitch = false;
      for (const mutation of mutations) {
        // Check for new tab elements
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SPAN') {
              hasTabChange = true;
              break;
            }
          }
        }
        // Check for workspace switch
        if (mutation.type === 'attributes' && mutation.attributeName === 'aria-owns') {
          hasWorkspaceSwitch = true;
        }
        if (hasTabChange && hasWorkspaceSwitch) break;
      }
      if (hasTabChange || hasWorkspaceSwitch) {
        const delay = hasWorkspaceSwitch ? CONFIG.delays.workspaceSwitch : CONFIG.delays.mutation;
        scheduleAttachButtons(delay);
      }
    });
    observer.observe(tabStrip, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-owns']
    });
  };
  // ==================== Panel Integration ====================
  const name = 'Tidy Tabs';
  const messageType = 'tidy-tabs';
  const nameAttribute = 'tidy-tabs';
  const webPanelId = 'WEBPANEL_tidy_tabs_8020-4841-8a5d-1555b86da114';
  const code = 'data:text/html,' + encodeURIComponent('<title>' + name + '</title>');
  let panelContent;
  const icons = {
    tidy: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M2 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H2zm0 1h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM6 5v6h1V5H6z m3 0v6h1V5H9z m3 0v6h1V5h-1z"/></svg>'
  };
  icons.dataURLs = {
    tidy: 'data:image/svg+xml, ' + icons.tidy,
  };
  const langs = {
    tidyCurrent: 'Tidy Current Workspace',
    enableAI: 'Enable AI Grouping',
    aiProvider: 'AI Provider',
    openaiUrl: 'OpenAI URL',
    openaiKey: 'OpenAI Key',
    openaiModel: 'OpenAI Model',
    ollamaUrl: 'Ollama URL',
    ollamaModel: 'Ollama Model',
    promptType: 'Prompt Template',
    includeExisting: 'Include Existing Stacks',
    customInstructions: 'Custom Instructions',
    autoStack: 'Auto Stack Workspaces',
    closePanel: gnoh.i18n.getMessage('Close Panel'),
  };
  const simulateWebviewButtonClick = ({ webPanelId, webviewButton, openOnly }) => {
    if (webPanelId) {
      // FIX 1: use data-name attribute, not name
      webviewButton = document.querySelector('.toolbar > .button-toolbar > .ToolbarButton-Button[data-name*="' + webPanelId + '"]');
    }
    if (openOnly && webviewButton.parentNode?.classList.contains('active')) {
      return;
    }
    const pointerDown = new PointerEvent('pointerdown', {
      view: window,
      bubbles: true,
      cancelable: true,
      buttons: 0,
      pointerType: 'mouse',
    });
    pointerDown.persist = () => { };
    gnoh.getReactProps(webviewButton)?.onPointerDown(pointerDown);
    webviewButton.dispatchEvent(new PointerEvent('pointerup', {
      view: window,
      bubbles: true,
      cancelable: true,
      buttons: 0,
      pointerType: 'mouse',
    }));
  };
  const createPanelCustom = async (panel, webviewButton) => {
    if (!chrome.extension.inIncognitoContext) {
      if (panel.dataset.tidyTabs) {
        return;
      }
      panel.dataset.tidyTabs = true;

      // FIX 4: suppress the webview so it doesn't steal focus or intercept events
      const webview = panel.querySelector('webview');
      if (webview) {
        webview.blur?.();
        webview.tabIndex = -1;
      }

      let showCloseButton = await vivaldi.prefs.get('vivaldi.panels.show_close_button');
      let autoClose = await vivaldi.prefs.get('vivaldi.panels.as_overlay.auto_close');
      let asOverlayEnabled = await vivaldi.prefs.get('vivaldi.panels.as_overlay.enabled');
      const buttonClose = gnoh.createElement('button', {
        class: 'close transparent',
        title: langs.closePanel,
        style: {
          display: showCloseButton && asOverlayEnabled && autoClose || !showCloseButton ? 'none' : 'flex',
        },
        events: {
          click() {
            simulateWebviewButtonClick({ webviewButton });
          },
        },
      });
      vivaldi.prefs.onChanged.addListener(({ path, value }) => {
        switch (path) {
          case 'vivaldi.panels.show_close_button':
            showCloseButton = value;
            buttonClose.style.display = showCloseButton && asOverlayEnabled && autoClose || !showCloseButton ? 'none' : 'flex';
            break;
          case 'vivaldi.panels.as_overlay.auto_close':
            autoClose = value;
            buttonClose.style.display = showCloseButton && asOverlayEnabled && autoClose || !showCloseButton ? 'none' : 'flex';
            break;
          case 'vivaldi.panels.as_overlay.enabled':
            asOverlayEnabled = value;
            buttonClose.style.display = showCloseButton && asOverlayEnabled && autoClose || !showCloseButton ? 'none' : 'flex';
            break;
        }
      });
      gnoh.createElement('span', {
        class: 'VivaldiSvgIcon',
        style: {
          '--IconSize': 16,
        },
        html: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="m12.5 5-1.4-1.4-3.1 3-3.1-3L3.5 5l3.1 3.1-3 2.9 1.5 1.4L8 9.5l2.9 2.9 1.5-1.4-3-2.9"/></svg>'
      }, buttonClose);
      const title = gnoh.createElement('h1', {
        html: '<span>' + name + '</span>',
      }, null, buttonClose);
      panelContent = gnoh.createElement('div', {
        class: 'tidy-tabs-content'
      });
      // Tidy button
      const tidyButton = gnoh.createElement('button', {
        type: 'button',
        class: 'tidy-button',
        text: langs.tidyCurrent,
        events: {
          click: tidyCurrentWorkspace
        }
      }, panelContent);
      // Enable AI checkbox
      const enableAILabel = gnoh.createElement('label', {
        text: langs.enableAI + ': '
      }, panelContent);
      const enableAICheckbox = gnoh.createElement('input', {
        type: 'checkbox',
        checked: CONFIG.enableAIGrouping,
        events: {
          change: (e) => {
            CONFIG.enableAIGrouping = e.target.checked;
            chrome.storage.local.set({ ENABLE_AI_GROUPING: CONFIG.enableAIGrouping });
          }
        }
      }, panelContent);

      // AI Settings Container
      const aiSettingsContainer = gnoh.createElement('div', {
        class: 'tidy-tabs-settings-container'
      }, panelContent);

      // Provider
      gnoh.createElement('label', { text: langs.aiProvider + ': ' }, aiSettingsContainer);
      const providerSelect = gnoh.createElement('select', {
        events: {
          change: (e) => {
            CONFIG.ai.provider = e.target.value;
            chrome.storage.local.set({ AI_PROVIDER: CONFIG.ai.provider });
            updateProviderFields();
          }
        }
      }, aiSettingsContainer);
      gnoh.createElement('option', { value: 'openai', text: 'OpenAI Compatible', selected: CONFIG.ai.provider === 'openai' }, providerSelect);
      gnoh.createElement('option', { value: 'ollama', text: 'Ollama', selected: CONFIG.ai.provider === 'ollama' }, providerSelect);

      const providerFieldsContainer = gnoh.createElement('div', {
        class: 'tidy-tabs-provider-fields'
      }, aiSettingsContainer);

      const updateProviderFields = () => {
        providerFieldsContainer.innerHTML = '';
        if (CONFIG.ai.provider === 'openai') {
          gnoh.createElement('label', { text: langs.openaiUrl + ': ' }, providerFieldsContainer);
          gnoh.createElement('input', {
            type: 'text', value: CONFIG.ai.openai.url, placeholder: 'e.g., https://api.openai.com/v1/chat/completions',
            events: { change: (e) => { CONFIG.ai.openai.url = e.target.value; chrome.storage.local.set({ OPENAI_URL: e.target.value }); } }
          }, providerFieldsContainer);

          gnoh.createElement('label', { text: langs.openaiKey + ': ' }, providerFieldsContainer);
          gnoh.createElement('input', {
            type: 'password', value: CONFIG.ai.openai.key,
            events: { change: (e) => { CONFIG.ai.openai.key = e.target.value; chrome.storage.local.set({ OPENAI_KEY: e.target.value }); } }
          }, providerFieldsContainer);

          gnoh.createElement('label', { text: langs.openaiModel + ': ' }, providerFieldsContainer);
          gnoh.createElement('input', {
            type: 'text', value: CONFIG.ai.openai.model, placeholder: 'gpt-4o-mini',
            events: { change: (e) => { CONFIG.ai.openai.model = e.target.value; chrome.storage.local.set({ OPENAI_MODEL: e.target.value }); } }
          }, providerFieldsContainer);
        } else {
          gnoh.createElement('label', { text: langs.ollamaUrl + ': ' }, providerFieldsContainer);
          gnoh.createElement('input', {
            type: 'text', value: CONFIG.ai.ollama.url, placeholder: 'http://localhost:11434/api/chat',
            events: { change: (e) => { CONFIG.ai.ollama.url = e.target.value; chrome.storage.local.set({ OLLAMA_URL: e.target.value }); } }
          }, providerFieldsContainer);

          gnoh.createElement('label', { text: langs.ollamaModel + ': ' }, providerFieldsContainer);
          gnoh.createElement('input', {
            type: 'text', value: CONFIG.ai.ollama.model, placeholder: 'llama3',
            events: { change: (e) => { CONFIG.ai.ollama.model = e.target.value; chrome.storage.local.set({ OLLAMA_MODEL: e.target.value }); } }
          }, providerFieldsContainer);
        }
      };
      updateProviderFields();

      // Prompt Dropdown
      gnoh.createElement('label', { text: langs.promptType + ': ' }, aiSettingsContainer);
      const promptSelect = gnoh.createElement('select', {
        events: {
          change: (e) => {
            CONFIG.ai.promptType = e.target.value;
            chrome.storage.local.set({ PROMPT_TYPE: CONFIG.ai.promptType });
          }
        }
      }, aiSettingsContainer);
      gnoh.createElement('option', { value: 'simple', text: 'Simple Prompt', selected: CONFIG.ai.promptType === 'simple' }, promptSelect);
      gnoh.createElement('option', { value: 'smart_grouper', text: 'Smart Grouper', selected: CONFIG.ai.promptType === 'smart_grouper' }, promptSelect);
      gnoh.createElement('option', { value: 'context_aware', text: 'Context Aware', selected: CONFIG.ai.promptType === 'context_aware' }, promptSelect);

      // Include Existing
      const includeLabel = gnoh.createElement('label', { text: langs.includeExisting + ': ' }, aiSettingsContainer);
      gnoh.createElement('input', {
        type: 'checkbox', checked: CONFIG.ai.includeExistingStacks,
        events: {
          change: (e) => {
            CONFIG.ai.includeExistingStacks = e.target.checked;
            chrome.storage.local.set({ INCLUDE_EXISTING_STACKS: CONFIG.ai.includeExistingStacks });
          }
        }
      }, includeLabel);

      // Custom Instructions
      gnoh.createElement('label', { text: langs.customInstructions + ': ' }, aiSettingsContainer);
      gnoh.createElement('textarea', {
        value: CONFIG.ai.customInstructions,
        events: {
          change: (e) => {
            CONFIG.ai.customInstructions = e.target.value;
            chrome.storage.local.set({ CUSTOM_INSTRUCTIONS: CONFIG.ai.customInstructions });
          }
        },
        style: { width: '100%', minHeight: '60px', resize: 'vertical' }
      }, aiSettingsContainer);
      // Auto stack workspaces
      const autoStackLabel = gnoh.createElement('h2', {
        text: langs.autoStack
      }, panelContent);
      const workspaces = await getAllWorkspaces();
      workspaces.forEach(workspace => {
        const wsLabel = gnoh.createElement('label', {
          text: workspace.name + ': '
        }, panelContent);
        const wsCheckbox = gnoh.createElement('input', {
          type: 'checkbox',
          checked: CONFIG.autoStackWorkspaces.includes(workspace.name),
          events: {
            change: (e) => {
              if (e.target.checked) {
                if (!CONFIG.autoStackWorkspaces.includes(workspace.name)) {
                  CONFIG.autoStackWorkspaces.push(workspace.name);
                }
              } else {
                const index = CONFIG.autoStackWorkspaces.indexOf(workspace.name);
                if (index > -1) {
                  CONFIG.autoStackWorkspaces.splice(index, 1);
                }
              }
              chrome.storage.local.set({ AUTO_STACK_WORKSPACES: CONFIG.autoStackWorkspaces });
            }
          }
        }, panelContent);
      });
      const panelHeader = gnoh.createElement('header', null, panel, [title]);
      panel.append(panelContent);
    } else if (webviewButton) {
      if (panel.dataset.tidyTabs) {
        return;
      }
      panel.dataset.tidyTabs = true;
      if (panel.classList.contains('visible')) {
        simulateWebviewButtonClick({ webviewButton });
      }
    }
  };
  // FIX 1, 2, 3: use data-name in CSS selectors, nuclear-override webpanel-content, position panel correctly
  const style = !chrome.extension.inIncognitoContext ? [
    '#panels-container.left #panels .webpanel-stack [data-tidy-tabs] header { padding-left: 9px; }',
    '#panels-container.right #panels .webpanel-stack [data-tidy-tabs] header { padding-left: 12px; }',
    '#panels-container #panels .webpanel-stack [data-tidy-tabs] header { padding-right: var(--scrollbarWidth); padding-top: 12px; }',
    '#panels-container #panels .webpanel-stack [data-tidy-tabs] header.webpanel-header { display: none !important; }',
    // FIX 3: nuclear override so React can't fight back, and give the panel correct positioning
    '#panels-container #panels .webpanel-stack [data-tidy-tabs] { position:relative !important; display:flex !important; flex-direction:column !important; min-height:0 !important; height:100% !important; }',
    '#panels-container #panels .webpanel-stack [data-tidy-tabs] .webpanel-content { display:none !important; visibility:hidden !important; opacity:0 !important; pointer-events:none !important; min-height:0 !important; height:0 !important; max-height:0 !important; flex:0 0 0 !important; overflow:hidden !important; }',
    '#panels-container #panels .webpanel-stack [data-tidy-tabs] .tidy-tabs-content { position:absolute; inset:0; z-index:10; overflow:auto; background:var(--colorBg); }',
    '.tidy-tabs-content { display: flex; flex-direction: column; padding: 10px; }',
    '.tidy-tabs-settings-container { display: flex; flex-direction: column; gap: 5px; margin: 10px 0; }',
    '.tidy-tabs-provider-fields { display: flex; flex-direction: column; gap: 5px; }',
    '.tidy-tabs-content button, .tidy-tabs-content input, .tidy-tabs-content select, .tidy-tabs-content textarea { margin: 5px 0; max-width: 100%; box-sizing: border-box; }',
    '.tidy-tabs-content label { display: block; margin-top: 5px; }',
    // FIX 2: button selector must use data-name, not name
    'button[data-name="' + webPanelId + '"] > img { display:none; }',
    'button[data-name="' + webPanelId + '"]:before { width: 16px; height: 16px; content: ""; background-color: var(--colorFg); -webkit-mask-box-image: url(' + JSON.stringify(icons.dataURLs.tidy) + '); }',
    '.color-behind-tabs-off .toolbar-mainbar button[data-name="' + webPanelId + '"]:before { background-color: var(--colorAccentFg); }',
    '.button-toolbar:active button[data-name="' + webPanelId + '"]:before { transform: scale(0.9); }',
    '.tidy-tabs-content .tidy-button { background-color: var(--colorBgIntense); color: var(--colorFg); padding: 8px 16px; border-radius: 4px; border: none; cursor: pointer; }',
  ] : [
    // FIX 2: incognito branch also needs data-name
    '.button-toolbar:has(button[data-name="' + webPanelId + '"]) { display:none !important; }',
    '.draggable-button:has(button[data-name="' + webPanelId + '"]) { display:none !important; }',
  ];
  gnoh.addStyle(style, nameAttribute);
  const updateIconAndTitle = () => {
    // FIX 1: use data-name attribute
    const webviewButtons = Array.from(document.querySelectorAll('.toolbar > .button-toolbar > .ToolbarButton-Button[data-name*="' + webPanelId + '"]'));
    const webPanelStack = gnoh.getReactProps('.panel-group .webpanel-stack')?.children?.filter(webPanel => webPanel) ?? [];
    const webPanelIndex = webPanelStack.findIndex(webPanel => webPanel.key === webPanelId) + 1;
    const panel = document.querySelector('.panel-group .webpanel-stack .panel.webpanel:nth-child(' + webPanelIndex + ')');
    if (panel && webviewButtons.length) {
      createPanelCustom(panel, webviewButtons[0]);
    }
    webviewButtons.forEach((wvb) => {
      if (!chrome.extension.inIncognitoContext) {
        if (wvb.dataset.tidyTabs) {
          return;
        }
        wvb.dataset.tidyTabs = true;
      }
    });
  };
  const createWebPanel = () => {
    vivaldi.prefs.get('vivaldi.panels.web.elements', (elements) => {
      let element = elements.find((e) => e.id === webPanelId);
      if (!element) {
        element = {
          activeUrl: code,
          faviconUrl: icons.dataURLs.tidy,
          faviconUrlValid: true,
          id: webPanelId,
          mobileMode: true,
          origin: 'user',
          resizable: false,
          title: name,
          url: code,  // FIX: was 'chrome://' + nameAttribute which is an invalid URL
          width: -1,
          zoom: 1,
        };
        elements.unshift(element);
      } else {
        // FIX 5: update existing element so stale URLs from old installs get corrected
        element.activeUrl = code;
        element.faviconUrl = icons.dataURLs.tidy;
        element.faviconUrlValid = true;
        element.url = code;
      }
      // FIX 5: always save, not just on create
      vivaldi.prefs.set({
        path: 'vivaldi.panels.web.elements',
        value: elements,
      });
      Promise.all(
        [
          'vivaldi.toolbars.panel',
          'vivaldi.toolbars.navigation',
          'vivaldi.toolbars.status',
          'vivaldi.toolbars.mail',
          'vivaldi.toolbars.mail_message',
          'vivaldi.toolbars.mail_composer',
        ].map((path) => vivaldi.prefs.get(path))
      ).then((toolbars) => {
        const hasTidyTabs = toolbars.some((toolbar) => toolbar.some((p) => p === webPanelId));
        if (!hasTidyTabs) {
          const panels = toolbars[0];
          const panelIndex = panels.findIndex(panel => panel.startsWith('WEBPANEL_'));
          panels.splice(panelIndex, 0, webPanelId);
          vivaldi.prefs.set({
            path: 'vivaldi.toolbars.panel',
            value: panels,
          });
        }
      });
    });
  };
  // Load stored config
  chrome.storage.local.get([
    'AI_PROVIDER', 'OPENAI_URL', 'OPENAI_KEY', 'OPENAI_MODEL', 
    'OLLAMA_URL', 'OLLAMA_MODEL', 'PROMPT_TYPE', 'INCLUDE_EXISTING_STACKS', 
    'CUSTOM_INSTRUCTIONS', 'ENABLE_AI_GROUPING', 'AUTO_STACK_WORKSPACES'
  ], (result) => {
    if (result.AI_PROVIDER) CONFIG.ai.provider = result.AI_PROVIDER;
    if (result.OPENAI_URL !== undefined) CONFIG.ai.openai.url = result.OPENAI_URL;
    if (result.OPENAI_KEY !== undefined) CONFIG.ai.openai.key = result.OPENAI_KEY;
    if (result.OPENAI_MODEL !== undefined) CONFIG.ai.openai.model = result.OPENAI_MODEL;
    if (result.OLLAMA_URL !== undefined) CONFIG.ai.ollama.url = result.OLLAMA_URL;
    if (result.OLLAMA_MODEL !== undefined) CONFIG.ai.ollama.model = result.OLLAMA_MODEL;
    if (result.PROMPT_TYPE) CONFIG.ai.promptType = result.PROMPT_TYPE;
    if (result.INCLUDE_EXISTING_STACKS !== undefined) CONFIG.ai.includeExistingStacks = result.INCLUDE_EXISTING_STACKS;
    if (result.CUSTOM_INSTRUCTIONS !== undefined) CONFIG.ai.customInstructions = result.CUSTOM_INSTRUCTIONS;
    
    CONFIG.enableAIGrouping = result.ENABLE_AI_GROUPING !== undefined ? result.ENABLE_AI_GROUPING : CONFIG.enableAIGrouping;
    CONFIG.autoStackWorkspaces = result.AUTO_STACK_WORKSPACES || CONFIG.autoStackWorkspaces;
  });
  // ==================== Initialization ====================
  const init = () => {
    console.log('Initializing TidyTabs extension');
    console.log('AI grouping:', CONFIG.enableAIGrouping ? 'enabled' : 'disabled');
    console.log('Auto-stack workspaces:', CONFIG.autoStackWorkspaces);
    setTimeout(attachButtons, CONFIG.delays.init);
    observeTabStrip();
    setupAutoStackListener();
  };
  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  gnoh.timeOut(() => {
    // FIX 1: use data-name attribute
    const webviewButtons = Array.from(document.querySelectorAll('.toolbar > .button-toolbar > .ToolbarButton-Button[data-name*="' + webPanelId + '"]'));
    if (webviewButtons.length) {
      updateIconAndTitle();
    } else {
      createWebPanel();
    }
  }, '#browser');
  gnoh.observeDOM(document, () => {
    updateIconAndTitle();
  });
})();