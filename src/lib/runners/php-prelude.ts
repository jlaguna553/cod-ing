/**
 * Lo que le falta a la biblioteca estándar del intérprete, escrito en PHP.
 *
 * Uniter trae el lenguaje —variables, arrays, `foreach`, funciones, clases,
 * closures, excepciones, interpolación, heredoc— pero su biblioteca estándar
 * está a medias: no hay `sort`, ni `print_r`, ni `array_map`, ni `floor`. Sin
 * eso no se puede enseñar PHP: la mitad de los ejercicios de un compendio usan
 * alguna de ellas en la primera línea.
 *
 * Se rellenan **en PHP**, no en JavaScript, y por dos motivos. El primero es
 * que así son las de verdad: mismos parámetros, mismo comportamiento con
 * arrays asociativos, mismo paso por referencia. El segundo es que se pueden
 * leer — quien tenga curiosidad por cómo ordena `sort` tiene el código a un
 * clic, y eso es material didáctico, no deuda.
 *
 * Lo que **no** se rellena se declara: no hay expresiones flecha (`fn() =>`),
 * ni el operador `**`, ni `sprintf('%05.2f')` con relleno de decimales. Son
 * límites del intérprete y las lecciones se escriben dentro de ellos; el
 * comprobador de contenido ejecuta cada solución con este mismo motor, así que
 * una lección que se salga no llega a publicarse.
 *
 * El prelude se antepone al código del usuario **sin `<?php`**, y los errores
 * se renumeran restando sus líneas: si no, un fallo en la línea 3 del ejercicio
 * se reportaría en la 180 y el mensaje sería inútil.
 */
export const PHP_PRELUDE = `
if (!defined('STR_PAD_RIGHT')) { define('STR_PAD_RIGHT', 1); }
if (!defined('STR_PAD_LEFT')) { define('STR_PAD_LEFT', 0); }

if (!function_exists('abs')) {
    function abs($n) { return $n < 0 ? -$n : $n; }
}

if (!function_exists('floor')) {
    function floor($n) {
        $i = (int)$n;
        return ($n < 0 && $i != $n) ? $i - 1 : $i;
    }
}

if (!function_exists('ceil')) {
    function ceil($n) {
        $i = (int)$n;
        return ($n > 0 && $i != $n) ? $i + 1 : $i;
    }
}

if (!function_exists('pow')) {
    function pow($base, $exp) {
        $r = 1;
        for ($i = 0; $i < abs($exp); $i++) { $r = $r * $base; }
        return $exp < 0 ? 1 / $r : $r;
    }
}

if (!function_exists('round')) {
    function round($n, $decimales = 0) {
        $f = pow(10, $decimales);
        $x = $n * $f;
        $r = $x < 0 ? -floor(-$x + 0.5) : floor($x + 0.5);
        return $decimales > 0 ? $r / $f : (int)$r;
    }
}

if (!function_exists('intdiv')) {
    function intdiv($a, $b) { return (int)($a / $b); }
}

if (!function_exists('max')) {
    function max($a, $b = null) {
        $lista = is_array($a) ? $a : func_get_args();
        $mejor = null;
        foreach ($lista as $v) { if ($mejor === null || $v > $mejor) { $mejor = $v; } }
        return $mejor;
    }
}

if (!function_exists('min')) {
    function min($a, $b = null) {
        $lista = is_array($a) ? $a : func_get_args();
        $mejor = null;
        foreach ($lista as $v) { if ($mejor === null || $v < $mejor) { $mejor = $v; } }
        return $mejor;
    }
}

if (!function_exists('array_sum')) {
    function array_sum($a) {
        $t = 0;
        foreach ($a as $v) { $t = $t + $v; }
        return $t;
    }
}

if (!function_exists('array_keys')) {
    function array_keys($a) {
        $r = [];
        foreach ($a as $k => $v) { $r[] = $k; }
        return $r;
    }
}

if (!function_exists('array_values')) {
    function array_values($a) {
        $r = [];
        foreach ($a as $v) { $r[] = $v; }
        return $r;
    }
}

if (!function_exists('array_map')) {
    function array_map($fn, $a) {
        $r = [];
        foreach ($a as $k => $v) { $r[$k] = $fn($v); }
        return array_values($r);
    }
}

if (!function_exists('array_filter')) {
    function array_filter($a, $fn = null) {
        $r = [];
        foreach ($a as $k => $v) {
            $ok = $fn === null ? ($v ? true : false) : $fn($v);
            if ($ok) { $r[$k] = $v; }
        }
        return $r;
    }
}

if (!function_exists('array_reduce')) {
    function array_reduce($a, $fn, $inicial = null) {
        $acc = $inicial;
        foreach ($a as $v) { $acc = $fn($acc, $v); }
        return $acc;
    }
}

if (!function_exists('array_reverse')) {
    function array_reverse($a) {
        $r = [];
        $vals = array_values($a);
        for ($i = count($vals) - 1; $i >= 0; $i--) { $r[] = $vals[$i]; }
        return $r;
    }
}

if (!function_exists('array_slice')) {
    function array_slice($a, $desde, $cuantos = null) {
        $vals = array_values($a);
        $total = count($vals);
        if ($desde < 0) { $desde = $total + $desde; }
        $fin = $cuantos === null ? $total : $desde + $cuantos;
        $r = [];
        for ($i = $desde; $i < $fin && $i < $total; $i++) { $r[] = $vals[$i]; }
        return $r;
    }
}

/**
 * Ordenación por inserción, y por referencia como la de verdad.
 *
 * No es la más rápida: es la que se lee de un vistazo, y con los tamaños de
 * un ejercicio la diferencia no existe.
 */
if (!function_exists('sort')) {
    function sort(&$a) {
        $vals = array_values($a);
        for ($i = 1; $i < count($vals); $i++) {
            $actual = $vals[$i];
            $j = $i - 1;
            while ($j >= 0 && $vals[$j] > $actual) {
                $vals[$j + 1] = $vals[$j];
                $j--;
            }
            $vals[$j + 1] = $actual;
        }
        $a = $vals;
        return true;
    }
}

if (!function_exists('rsort')) {
    function rsort(&$a) {
        sort($a);
        $a = array_reverse($a);
        return true;
    }
}

if (!function_exists('usort')) {
    function usort(&$a, $cmp) {
        $vals = array_values($a);
        for ($i = 1; $i < count($vals); $i++) {
            $actual = $vals[$i];
            $j = $i - 1;
            while ($j >= 0 && $cmp($vals[$j], $actual) > 0) {
                $vals[$j + 1] = $vals[$j];
                $j--;
            }
            $vals[$j + 1] = $actual;
        }
        $a = $vals;
        return true;
    }
}

if (!function_exists('ksort')) {
    function ksort(&$a) {
        $claves = array_keys($a);
        sort($claves);
        $r = [];
        foreach ($claves as $k) { $r[$k] = $a[$k]; }
        $a = $r;
        return true;
    }
}

if (!function_exists('str_pad')) {
    function str_pad($s, $largo, $relleno = ' ', $lado = STR_PAD_RIGHT) {
        $s = (string)$s;
        while (strlen($s) < $largo) {
            $s = $lado == STR_PAD_LEFT ? $relleno . $s : $s . $relleno;
        }
        return $s;
    }
}

if (!function_exists('ucwords')) {
    function ucwords($s) {
        $r = '';
        $inicio = true;
        for ($i = 0; $i < strlen($s); $i++) {
            $c = $s[$i];
            $r = $r . ($inicio ? strtoupper($c) : $c);
            $inicio = ($c == ' ' || $c == '-');
        }
        return $r;
    }
}

if (!function_exists('str_split')) {
    function str_split($s, $largo = 1) {
        $r = [];
        for ($i = 0; $i < strlen($s); $i = $i + $largo) {
            $trozo = '';
            for ($j = 0; $j < $largo && $i + $j < strlen($s); $j++) { $trozo = $trozo . $s[$i + $j]; }
            $r[] = $trozo;
        }
        return $r;
    }
}

if (!function_exists('strrev')) {
    function strrev($s) {
        $r = '';
        for ($i = strlen($s) - 1; $i >= 0; $i--) { $r = $r . $s[$i]; }
        return $r;
    }
}

if (!function_exists('number_format')) {
    function number_format($n, $decimales = 0) {
        $r = (string)round($n, $decimales);
        if ($decimales > 0) {
            $punto = strpos($r, '.');
            if ($punto === false) { $r = $r . '.'; $punto = strlen($r) - 1; }
            while (strlen($r) - $punto - 1 < $decimales) { $r = $r . '0'; }
        }
        return $r;
    }
}

if (!function_exists('printf')) {
    function printf($formato) {
        $args = func_get_args();
        $resto = array_slice($args, 1);
        echo vsprintf_simple($formato, $resto);
        return 1;
    }
}

/** Solo lo que usan las lecciones: %s, %d y %%. Nada de anchos ni decimales. */
if (!function_exists('vsprintf_simple')) {
    function vsprintf_simple($formato, $args) {
        $salida = '';
        $i = 0;
        $arg = 0;
        while ($i < strlen($formato)) {
            $c = $formato[$i];
            if ($c == '%' && $i + 1 < strlen($formato)) {
                $siguiente = $formato[$i + 1];
                if ($siguiente == '%') { $salida = $salida . '%'; $i = $i + 2; continue; }
                if ($siguiente == 's') { $salida = $salida . (string)$args[$arg]; $arg++; $i = $i + 2; continue; }
                if ($siguiente == 'd') { $salida = $salida . (string)(int)$args[$arg]; $arg++; $i = $i + 2; continue; }
            }
            $salida = $salida . $c;
            $i++;
        }
        return $salida;
    }
}

/** Igual que el de PHP para lo que se ve en una lección: arrays y escalares. */
if (!function_exists('print_r')) {
    function print_r($valor, $devolver = false) {
        $texto = print_r_interno($valor, '');
        if ($devolver) { return $texto; }
        echo $texto;
        return true;
    }
}

if (!function_exists('print_r_interno')) {
    function print_r_interno($valor, $sangria) {
        if (!is_array($valor)) { return (string)$valor; }

        $texto = "Array\\n" . $sangria . "(\\n";
        foreach ($valor as $k => $v) {
            $texto = $texto . $sangria . '    [' . $k . '] => ' . print_r_interno($v, $sangria . '    ') . "\\n";
        }
        return $texto . $sangria . ")\\n";
    }
}

if (!function_exists('json_encode')) {
    function json_encode($valor) {
        if (is_array($valor)) {
            $esLista = true;
            $i = 0;
            foreach ($valor as $k => $v) {
                if ($k !== $i) { $esLista = false; }
                $i++;
            }

            $partes = [];
            foreach ($valor as $k => $v) {
                $partes[] = $esLista ? json_encode($v) : json_encode((string)$k) . ':' . json_encode($v);
            }
            $dentro = implode(',', $partes);
            return $esLista ? '[' . $dentro . ']' : '{' . $dentro . '}';
        }

        if (is_string($valor)) { return '"' . str_replace('"', '\\\\"', $valor) . '"'; }
        if (is_bool($valor)) { return $valor ? 'true' : 'false'; }
        if ($valor === null) { return 'null'; }
        return (string)$valor;
    }
}
`;

/** Cuántas líneas ocupa el prelude, para renumerar los errores del usuario. */
export const PRELUDE_LINES = PHP_PRELUDE.split('\n').length - 1;
