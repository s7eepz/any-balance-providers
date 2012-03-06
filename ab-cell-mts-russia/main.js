﻿/**
Провайдер AnyBalance (http://any-balance-providers.googlecode.com)

Текущий баланс у сотового оператора МТС (центр). Вход через PDA-версию.
Вдохновение почерпано у http://mtsoft.ru

Сайт оператора: http://mts.ru/
Личный кабинет: https://ip.mts.ru/SELFCAREPDA/
*/
var regions = {
	auto: "https://ip.mts.ru/SELFCAREPDA/", 
	center: "https://ip.mts.ru/SELFCAREPDA/",
	primorye: "https://ihelper.primorye.mts.ru/SelfCarePda/",
	nnov: "https://ip.nnov.mts.ru/selfcarepda/",
	nw: "https://ihelper.nw.mts.ru/SELFCAREPDA/",
	sib: "https://ip.sib.mts.ru/SELFCAREPDA/",
	ural: "https://ip.nnov.mts.ru/selfcarepda/", //Почему-то урал в конце концов переадресуется сюда
	ug: "https://ihelper.ug.mts.ru/SelfCarePda/"
};

function getParam (html, result, param, regexp, replaces, parser) {
	if (!AnyBalance.isAvailable (param))
		return;

	var value = regexp.exec (html);
	if (value) {
		value = value[1];
		if (replaces) {
			for (var i = 0; i < replaces.length; i += 2) {
				value = value.replace (replaces[i], replaces[i+1]);
			}
		}
		if (parser)
			value = parser (value);
		result[param] = value;
	}
}

function main(){
    var prefs = AnyBalance.getPreferences();
    if(!regions[prefs.region]){
	AnyBalance.trace("Unknown region: " + prefs.region + ", setting to auto");
        prefs.region = 'auto';
    }

    var baseurl = regions[prefs.region];

    AnyBalance.trace("Trying to enter selfcare at address: " + baseurl);
    var html = AnyBalance.requestPost(baseurl + "Security.mvc/LogOn", {
    	username: prefs.login,
        password: prefs.password
    });

    var regexp=/<form .*?id="redirect-form".*?action="[^"]*\.([^\.]+)\.mts\.ru/, res, tmp;
    if (res=regexp.exec(html)){
        //Неправильный регион. Умный мтс нас редиректит
	//Только эта скотина не всегда даёт правильную ссылку, иногда даёт такую, которая требует ещё редиректов
	//Поэтому приходится вычленять из ссылки непосредственно нужный регион
	if(!regions[res[1]])
        	throw new AnyBalance.Error("mts has redirected to unknown region: " + res[1]);
		
	baseurl = regions[res[1]];
    	AnyBalance.trace("Redirected, now trying to enter selfcare at address: " + baseurl);
        html = AnyBalance.requestPost(baseurl + "Security.mvc/LogOn", {
    		username: prefs.login,
        	password: prefs.password
        });
    }


    regexp=/<ul class="operation-results-error"><li>(.*?)<\/li>/;
    if (res=regexp.exec(html)){
        throw new AnyBalance.Error(res[1]);
    }
    
    regexp=/<title>Произошла ошибка<\/title>/;
    if(regexp.exec(html)){
        throw new AnyBalance.Error("Интернет-помощник временно недоступен");
    }

    var result = {success: true};

    regexp = /Security\.mvc\/LogOff/;
    if(regexp.exec(html))
    	AnyBalance.trace("It looks like we are in selfcare (found logOff)...");
    else
    	AnyBalance.trace("Have not found logOff... Wrong login and password or other error. Please contact author.");

    // Тарифный план
    regexp=/Тарифный план.*?>(.*?)</;
    if (res=regexp.exec(html)){
        result.__tariff=res[1];
    }

    // Баланс
    getParam (html, result, 'balance', /Баланс.*>([-\d.]*)</, [/ |\xA0/, "", ",", "."], parseFloat);

    if (AnyBalance.isAvailable ('min_left') ||
        AnyBalance.isAvailable ('min_local') ||
        AnyBalance.isAvailable ('min_love') ||
        AnyBalance.isAvailable ('sms_left') ||
        AnyBalance.isAvailable ('mms_left') ||
        AnyBalance.isAvailable ('traffic_left') ||
        AnyBalance.isAvailable ('license') ||
        AnyBalance.isAvailable ('statuslock') ||
        AnyBalance.isAvailable ('credit') ||
        AnyBalance.isAvailable ('usedinthismonth')) {

        AnyBalance.trace("Fetching status...");

        html = AnyBalance.requestGet(baseurl + "Account.mvc/Status");

        AnyBalance.trace("Parsing status...");
    
        // Пакет минут
        getParam (html, result, 'min_left', /Остаток пакета минут:\s*([\d\.,]+)\./, [/ |\xA0/, "", ",", "."], parseFloat);
    
        // Остаток бонуса
        getParam (html, result, 'min_left', /Остаток бонуса:\s*([\d\.,]+?)\s*мин/, [/ |\xA0/, "", ",", "."], parseFloat);

        // Остаток минут
        getParam (html, result, 'min_left', /Осталось\s*([\d\.,]+)\s*мин/i, [",", "."], parseFloat);
        
        // Остаток: минут
        getParam (html, result, 'min_left', /Остаток:\s*([\d\.,]+)\s*минут/i, [",", "."], parseFloat);

        // Использовано: 0 минут местных и мобильных вызовов.
        getParam (html, result, 'min_local', /Использовано:\s*([\d\.,]+)\s*мин[^\s]* местных/, [/ |\xA0/, "", ",", "."], parseFloat);

        // Использовано: 0 минут на любимые номера
        getParam (html, result, 'min_love', /Использовано:\s*([\d\.,]+)\s*мин[^\s]* на любимые/, [/ |\xA0/, "", ",", "."], parseFloat);

        // Остаток СМС
        getParam (html, result, 'sms_left', /(?:Осталось|Остаток)[^\d]*(\d*)\s*(sms|смс)/i, [], parseInt);

        // Остаток ММС
        getParam (html, result, 'mms_left', /(?:Осталось|Остаток)[^\d]*(\d*)\s*(mms|ммс)/i, [], parseInt);

        // Накоплено 54 мин. в текущем месяце
        getParam (html, result, 'min_used', /Накоплено\s*(\d+)\s*мин[^\s]*/, [/ |\xA0/, ""], parseInt);

        // Сумма по неоплаченным счетам: 786.02 руб. (оплатить до 24.03.2012)
        getParam (html, result, 'debt', /Сумма по неоплаченным счетам.*?>([-\d\.]*)/i, [/ |\xA0/, ""], parseFloat);

        // Сумма по неоплаченным счетам: 786.02 руб. (оплатить до 24.03.2012)
        getParam (html, result, 'pay_till', /оплатить до\s*([\d\.\/]+)/i, [], parseTime);

        // Остаток трафика
        getParam (html, result, 'traffic_left', /(?:Осталось|Остаток)[^\d]*(\d+,?\d* *(kb|mb|gb|кб|мб|гб))/i);

        // Лицевой счет
        getParam (html, result, 'license', /№ .*?(.*?):/);

        // Блокировка
        getParam (html, result, 'statuslock', /class="account-status-lock".*>(Номер [^<]*)</i);

        // Сумма кредитного лимита
        getParam (html, result, 'credit', /Сумма кредитного лимита.*?>([-\d\.]*)/i, [",", "."], parseFloat);

        // Расход за этот месяц
        getParam (html, result, 'usedinthismonth', /Израсходовано .*?<strong>([\d.]*)/i, [], parseFloat);
    }


    if (AnyBalance.isAvailable ('usedinprevmonth')) {

        AnyBalance.trace("Fetching history...");

        html = AnyBalance.requestPost (baseurl + 'Account.mvc/History', {periodIndex: 0});

        AnyBalance.trace("Parsing history...");

        // Расход за прошлый месяц
        getParam (html, result, 'usedinprevmonth', /За период израсходовано <strong>([\d.]*)</i, [], parseFloat);
    }


    if (AnyBalance.isAvailable ('monthlypay')) {

        AnyBalance.trace("Fetching traffic info...");

        html = AnyBalance.requestGet (baseurl + 'TariffChange.mvc');

        AnyBalance.trace("Parsing traffic info...");

        // Ежемесячная плата
        getParam (html, result, 'monthlypay', /Ежемесячная плата[^\d]*([\d.]*)/i, [",", "."], parseFloat);
    }

    AnyBalance.setResult(result);

}

function parseTime(date){
    AnyBalance.trace("Trying to parse date from " + date);
    var dateParts = date.split(/[\.\/]/);
    var d = new Date(dateParts[2], (dateParts[1] - 1), dateParts[0]);
    return d.getTime();
}
