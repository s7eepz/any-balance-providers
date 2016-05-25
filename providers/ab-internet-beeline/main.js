﻿/**
Провайдер AnyBalance (http://any-balance-providers.googlecode.com)
*/

var g_headers = {
	'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
	'Accept-Charset': 'windows-1251,utf-8;q=0.7,*;q=0.3',
	'Accept-Language': 'ru-RU,ru;q=0.8,en-US;q=0.6,en;q=0.4',
	'Connection': 'keep-alive',
	'User-Agent': 'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/29.0.1547.76 Safari/537.36',
};

function main() {
	var prefs = AnyBalance.getPreferences();
	
	checkEmpty(prefs.login, 'Введите логин!');
	checkEmpty(prefs.password, 'Введите пароль!');

	switch (prefs.type) {
		case 'cab': 
			try{
				proceedCab(prefs);
				break;
			}catch(e){
				if(!/ни одного активного счета/i.test(e.message)){
					throw e;
				}
				AnyBalance.trace('Логин пароль подошел, а счет не найден. Наверное, это офис...');
				//breakthrough;
			}
		case 'office':
			proceedOffice(prefs);
			break;
		default:
			proceedLk(prefs);
			break;
	}
}

function requestJson(url, data, headers) {
	var json = getJson(AnyBalance.requestPost(url, data, headers));
	
	if(!json.success) {
		AnyBalance.trace(JSON.stringify(json));
		throw new AnyBalance.Error('Возникла ошибка при выполнении запроса: ' + json.error, null, /парол/i.test(json.error));
	}
	
	return json;
}

function proceedOffice(prefs) {

	var baseurl = 'https://cabinet.beeline.ru/';
	AnyBalance.setDefaultCharset('windows-1251');

	var html = AnyBalance.requestGet(baseurl + 'myoffice/', g_headers);

	if (!/logout/i.test(html)) {
		var enter = getParam(html, null, null, /<input[^>]+__SAVE[^>]+value=['"]([^'"]*)/i, replaceTagsAndSpaces);
	    
		html = AnyBalance.requestPost(baseurl + 'myoffice/', {
			login: prefs.login,
			passwd: prefs.password,
			__SAVE: enter
		}, { Referer: baseurl + 'myoffice/' });
	}

	if (!/logout/i.test(html)) {
		AnyBalance.trace(html);
		throw new AnyBalance.Error('Не удалось зайти на сайт. Проверьте логин пароль и правильность выбора личного кабинета.');
	}

	var result = { success: true };

	getParam(html, result, '__tariff', /Тариф(?:[^<]*<[^>]+>){3}([^<]+)/i, replaceTagsAndSpaces);
	getParam(html, result, 'bill', /<b>Лицевой счет(?:[^<]*<[^>]+>){3}([^<]+)/i, replaceTagsAndSpaces);
	getParam(html, result, 'balance', /Текущее состояние лицевого счёта(?:[^<]*<[^>]+>){3}([^<]+)/i, replaceTagsAndSpaces, parseBalance);

	if (AnyBalance.isAvailable('status')) {
		html = AnyBalance.requestGet(baseurl + 'myoffice/?section=num_info', g_headers);
		getParam(html, result, 'status', /Статус(?:[^<]*<[^>]+>){2}([^<]+)/i, replaceTagsAndSpaces);
	}

	AnyBalance.setResult(result);
}

function proceedCab(prefs) {
	var baseurl = 'https://cabinet.beeline.ru/';
	AnyBalance.setDefaultCharset('utf-8');
	
	var html = AnyBalance.requestGet(baseurl + 'lk/', g_headers);
	
	var json = requestJson(baseurl + 'lk/ajax.php', {
		module:'bee_lk.auth',
		action:'login',
		v_login: prefs.login,
		v_password: prefs.password,
	}, addHeaders({ Referer: baseurl + 'lk/', 'X-Requested-With': 'XMLHttpRequest'}));
	
	var result = {success: true};

	var current;
	for(var i = 0; i < json.client.net.nums.length; i++) {
		current = json.client.net.nums[i];
		
		var state = current['v_nmstatus'];
		if(/Активeн/i.test(state)) {
			AnyBalance.trace('Нашли активный счет: ' + current['v_nmbillgroup']);
			break;
		} else {
			AnyBalance.trace('Cчет: ' + current['v_nmbillgroup'] + ' не активен');
		}
	}
	// Телефон
	var current_phone;
	for(var i = 0; i < json.client.phone.nums.length; i++) {
		var current_phone = json.client.phone.nums[i];
		
		var state = current_phone['v_nmstatus'];
		if(/Активeн/i.test(state)) {
			AnyBalance.trace('Нашли активный счет: ' + current_phone['v_nmbillgroup']);
			break;
		} else {
			AnyBalance.trace('Cчет: ' + current_phone['v_nmbillgroup'] + ' не активен');
		}
	}
	
	if(!current && !current_phone)
		throw new AnyBalance.Error('Не удалось найти ни одного активного счета, сайт изменен?');
	
	if(current) {
		getParam(current['v_saldo'], result, 'balance', null, replaceTagsAndSpaces, parseBalance);
		getParam(current['v_nmbplan'], result, '__tariff', null, replaceTagsAndSpaces);
		sumParam(current['v_nmbillgroup'], result, 'bill', null, replaceTagsAndSpaces, null, aggregate_join);
	}
	
	if(current_phone) {
		getParam(current_phone['v_saldo'], result, 'balance_phone', null, replaceTagsAndSpaces, parseBalance);
		sumParam('ТФ:' + current_phone['v_nmbillgroup'], result, 'bill', null, replaceTagsAndSpaces, null, aggregate_join);
	}
	
	AnyBalance.setResult(result);
}

function proceedLk(prefs) {
	AnyBalance.setDefaultCharset('utf-8');
	var baseurl = "https://lk.beeline.ru/";
	
	if (!prefs.__dbg) {
		var html = AnyBalance.requestGet(baseurl); //Чтобы кука установилась
		html = AnyBalance.requestPost(baseurl, {
			login: prefs.login,
			password: prefs.password
		});
	} else {
		//Из-за ошибки в Хроме логин не может быть выполнен, потому что там используется переадресация с безопасного на обычное соединение.
		//Чтобы отлаживать в отладчике, зайдите в свой аккаунт вручную, и раскоментарьте эти строчки. Не забудьте закоментарить обратно потом!
		var html = AnyBalance.requestGet(baseurl + 'news/');
	}
	
	if (!/\/logout\//.test(html)) {
		var error = getParam(html, null, null, /<ul class="errorlist">([\s\S]*?)<\/ul>/i, replaceTagsAndSpaces, html_entity_decode);
		if (error) throw new AnyBalance.Error(error, null, /Логин или пароль неправильные/i.test(error));
		AnyBalance.trace(html);
		throw new AnyBalance.Error('Не удалось зайти в личный кабинет. Сайт изменен?');
	}
	
	var result = {success: true};
	
	getParam(html, result, 'balance', /Баланс:[\s\S]*?<span[^>]*>([^<]*)/i, replaceTagsAndSpaces, parseBalance);
	getParam(html, result, 'bonus', /Бонусы:[\s\S]*?<span[^>]*>([^<]*)/i, replaceTagsAndSpaces, parseBalance);
	
	if (AnyBalance.isAvailable('status', 'status_internet', 'status_tv', 'userName', 'till', 'topay', 'abon', 'bill')) {
		html = AnyBalance.requestGet(baseurl + 'personal/');
		
		getParam(html, result, 'status', /usluga_name">Текущий статус[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i, replaceTagsAndSpaces);
		getParam(html, result, 'status_internet', /usluga_name">Интернет[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i, replaceTagsAndSpaces);
		getParam(html, result, 'status_tv', /usluga_name">Телевидение[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i, replaceTagsAndSpaces);
		getParam(html, result, 'userName', /usluga_name">Владелец договора[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i, replaceTagsAndSpaces);
		getParam(html, result, 'till', /Дата окончания расчетного периода[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i, replaceTagsAndSpaces, parseDate);
		getParam(html, result, 'topay', /Сумма к оплате[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i, replaceTagsAndSpaces, parseBalance);
		getParam(html, result, 'abon', /Сумма ежемесячного платежа[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i, replaceTagsAndSpaces, parseBalance);
		getParam(html, result, 'bill', />Лицевой счет(?:[^>]*>){3}([\s\S]*?)<\//i, replaceTagsAndSpaces);
	}
	
	html = AnyBalance.requestGet(baseurl + 'internet/');
	
	getParam(html, result, '__tariff', /Тарифный план[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i, replaceTagsAndSpaces);
	getParam(html, result, 'traffic', /Предоплаченный трафик[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i, replaceTagsAndSpaces, parseTrafficGb);
	
	AnyBalance.setResult(result);
}

function parseTrafficGb(str) {
	var val = getParam(str.replace(/\s+/g, ''), null, null, /(-?\d[\d\s.,]*)/, replaceTagsAndSpaces, parseBalance);
	return parseFloat((val / 1000).toFixed(2));
}